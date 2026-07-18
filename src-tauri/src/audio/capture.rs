use crate::state::AudioCommand;
use anyhow::{bail, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::Emitter;

/// Set once at app setup so the audio thread (spawned before the Tauri app
/// exists) can surface stream errors to the UI.
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP.set(handle);
}

fn emit_state(msg: &str) {
    if let Some(app) = APP.get() {
        let _ = app.emit("patter://state", msg);
    }
}

pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = (input.len() as f64 / ratio) as usize;
    
    // If downsampling, use an exact boxcar filter (averaging) to prevent high-frequency aliasing.
    // Linear interpolation throws away 2/3 of the audio data and causes extreme metallic distortion.
    if ratio > 1.0 {
        (0..out_len)
            .map(|i| {
                let start_exact = i as f64 * ratio;
                let end_exact = (i + 1) as f64 * ratio;
                
                let start_idx = start_exact.floor() as usize;
                let end_idx = (end_exact.ceil() as usize).min(input.len());
                
                if start_idx >= input.len() {
                    return 0.0;
                }
                
                let mut sum = 0.0;
                let mut weight = 0.0;
                
                for j in start_idx..end_idx {
                    let sample_start = j as f64;
                    let sample_end = (j + 1) as f64;
                    
                    let overlap_start = start_exact.max(sample_start);
                    let overlap_end = end_exact.min(sample_end);
                    let overlap = (overlap_end - overlap_start).max(0.0);
                    
                    sum += input[j] * overlap as f32;
                    weight += overlap as f32;
                }
                
                if weight > 0.0 {
                    sum / weight
                } else {
                    input[start_idx]
                }
            })
            .collect()
    } else {
        // Upsampling: linear interpolation is fine
        (0..out_len)
            .map(|i| {
                let pos = i as f64 * ratio;
                let idx = pos as usize;
                let frac = (pos - idx as f64) as f32;
                let a = input[idx.min(input.len() - 1)];
                let b = input[(idx + 1).min(input.len() - 1)];
                a + (b - a) * frac
            })
            .collect()
    }
}

pub fn create_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    buf: Arc<Mutex<Vec<f32>>>,
    tx: Sender<AudioCommand>,
) -> Result<cpal::Stream> {
    let err_buf = buf.clone();
    let err_fn = move |e| {
        eprintln!("stream error: {e}");
        let _ = tx.send(AudioCommand::Reconnect(err_buf.clone()));
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.clone().into(),
            move |data: &[f32], _| buf.lock().unwrap().extend_from_slice(data),
            err_fn,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.clone().into(),
            move |data: &[i16], _| {
                let mut b = buf.lock().unwrap();
                b.extend(data.iter().map(|&s| s as f32 / i16::MAX as f32));
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.clone().into(),
            move |data: &[u16], _| {
                let mut b = buf.lock().unwrap();
                b.extend(data.iter().map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0));
            },
            err_fn,
            None,
        )?,
        fmt => bail!("unsupported sample format: {fmt:?}"),
    };
    Ok(stream)
}

/// Sets up the default input device and spawns the background thread that owns
/// the cpal stream, reacting to `AudioCommand`s sent from the recording/hotkey path.
pub fn init_audio() -> (Sender<AudioCommand>, Arc<Mutex<cpal::SupportedStreamConfig>>) {
    let (tx, rx): (Sender<AudioCommand>, Receiver<AudioCommand>) = channel();

    let host = cpal::default_host();
    let initial_dev = host.default_input_device().unwrap();
    let initial_cfg = initial_dev.default_input_config().unwrap();
    let shared_config = Arc::new(Mutex::new(initial_cfg));
    let thread_config = shared_config.clone();

    let tx_for_audio = tx.clone();

    thread::spawn(move || {
        let mut stream: Option<cpal::Stream> = None;
        for cmd in rx {
            match cmd {
                AudioCommand::Start(captured, mic_name) => {
                    if stream.is_some() {
                        stream = None;
                    }
                    let host = cpal::default_host();
                    let mut device = host.default_input_device().expect("no default input device");
                    if let Some(name) = mic_name {
                        if let Ok(devices) = host.input_devices() {
                            for d in devices {
                                if d.name().unwrap_or_default() == name {
                                    device = d;
                                    break;
                                }
                            }
                        }
                    }
                    if let Ok(cfg) = device.default_input_config() {
                        *thread_config.lock().unwrap() = cfg.clone();
                        if let Ok(s) = create_stream(&device, &cfg, captured, tx_for_audio.clone()) {
                            s.play().unwrap();
                            stream = Some(s);
                        }
                    }
                }
                AudioCommand::Stop => {
                    stream = None;
                }
                AudioCommand::Reconnect(captured) => {
                    eprintln!("Audio stream failed. Reconnecting...");
                    emit_state("⚠ Mic disconnected — reconnecting…");
                    stream = None;

                    let host = cpal::default_host();
                    if let Some(dev) = host.default_input_device() {
                        if let Ok(cfg) = dev.default_input_config() {
                            *thread_config.lock().unwrap() = cfg.clone();
                            if let Ok(s) = create_stream(&dev, &cfg, captured, tx_for_audio.clone()) {
                                s.play().unwrap();
                                stream = Some(s);
                                eprintln!("Reconnected successfully.");
                                emit_state("✓ Mic reconnected");
                            }
                        }
                    }
                    if stream.is_none() {
                        emit_state("⚠ Mic unavailable — no audio being captured");
                    }
                }
            }
        }
    });

    (tx, shared_config)
}
