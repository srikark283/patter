#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asr;
mod models;
mod db;

use anyhow::{bail, Result};
use arboard::Clipboard;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_nspanel::{tauri_panel, PanelBuilder, PanelLevel};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const WHISPER_SAMPLE_RATE: u32 = 16_000;
const FFT_SIZE: usize = 128;

tauri_panel! {
    panel!(HUDPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

enum AudioCommand {
    Start(Arc<Mutex<Vec<f32>>>),
    Stop,
    Reconnect(Arc<Mutex<Vec<f32>>>),
}

struct AppState {
    pub captured: Arc<Mutex<Vec<f32>>>,
    pub audio_tx: std::sync::mpsc::Sender<AudioCommand>,
    pub device_config: Arc<Mutex<cpal::SupportedStreamConfig>>,
    pub is_recording: Arc<AtomicBool>,
    pub engine: Arc<Mutex<Option<Box<dyn asr::ASREngine>>>>,
    pub model_manager: models::registry::ModelManager,
    pub output_mode: Arc<Mutex<String>>,
    pub custom_prompt: Arc<Mutex<String>>,
}

#[tauri::command]
async fn download_model(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let app_handle = app.clone();
    
    if id == "parakeet-tdt" {
        state.model_manager.download_parakeet(move |pct| {
            let _ = app_handle.emit("download_progress", models::registry::DownloadProgress {
                id: "parakeet-tdt".to_string(),
                pct,
            });
        }).await.map_err(|e| e.to_string())?;
    } else {
        return Err("Unknown model".into());
    }
    
    Ok(())
}

#[tauri::command]
fn set_output_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.output_mode.lock().unwrap() = mode;
    Ok(())
}

#[tauri::command]
async fn set_custom_prompt(app: tauri::AppHandle, prompt: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.custom_prompt.lock().unwrap() = prompt;
    Ok(())
}

#[tauri::command]
fn get_stats(app: tauri::AppHandle) -> db::AppStats {
    db::Db::new(&app).get_stats()
}

#[tauri::command]
fn get_history(app: tauri::AppHandle) -> Vec<db::TranscriptionRecord> {
    db::Db::new(&app).get_history()
}

#[tauri::command]
fn clear_history(app: tauri::AppHandle) {
    db::Db::new(&app).clear_history()
}

#[tauri::command]
fn is_recording(app: tauri::AppHandle) -> bool {
    app.state::<AppState>().is_recording.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_engine(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let models_dir = state.model_manager.get_models_dir();
    
    let engine: Box<dyn asr::ASREngine> = match id.as_str() {
        "parakeet-tdt" => {
            let dir = models_dir.join("parakeet-tdt").to_string_lossy().to_string();
            Box::new(asr::parakeet::ParakeetEngine::new(&dir).map_err(|e| e.to_string())?)
        },
        "whisper" => {
            // Default whisper location
            Box::new(asr::whisper::WhisperEngine::new("models/ggml-base.en.bin").map_err(|e| e.to_string())?)
        },
        _ => return Err("Unknown engine".into())
    };
    
    *state.engine.lock().unwrap() = Some(engine);
    Ok(())
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("dashboard").is_none() {
        tauri::WebviewWindowBuilder::new(&app, "dashboard", WebviewUrl::App("dashboard.html".into()))
            .title("Patter Dashboard")
            .inner_size(800.0, 600.0)
            .build()
            .map_err(|e| e.to_string())?;
    } else {
        app.get_webview_window("dashboard").unwrap().set_focus().unwrap();
    }
    Ok(())
}

fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = (input.len() as f64 / ratio) as usize;
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

fn create_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    buf: Arc<Mutex<Vec<f32>>>,
    tx: std::sync::mpsc::Sender<AudioCommand>,
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

fn extract_levels(fft: &std::sync::Arc<dyn rustfft::Fft<f32>>, samples: &[f32]) -> [f32; 5] {
    let mut buffer: Vec<Complex<f32>> = samples
        .iter()
        .map(|&s| Complex { re: s, im: 0.0 })
        .collect();
    
    for (i, v) in buffer.iter_mut().enumerate() {
        let multiplier = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE as f32 - 1.0)).cos());
        v.re *= multiplier;
    }

    fft.process(&mut buffer);

    let mut levels = [0.0; 5];
    let bins = FFT_SIZE / 2;
    let band_size = bins / 5;
    
    for (i, val) in levels.iter_mut().enumerate() {
        let start = i * band_size;
        let end = if i == 4 { bins } else { start + band_size };
        let mut sum = 0.0;
        for j in start..end {
            sum += buffer[j].norm();
        }
        *val = sum / (end - start) as f32;
    }
    levels
}

fn start_recording(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    println!("🔴 recording...");
    state.captured.lock().unwrap().clear();
    state.is_recording.store(true, Ordering::SeqCst);
    
    let _ = app.emit("patter://state", "Listening...");
    let _ = state.audio_tx.send(AudioCommand::Start(state.captured.clone()));

    let app_handle = app.clone();
    let is_rec = state.is_recording.clone();
    let captured = state.captured.clone();

    thread::spawn(move || {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        
        let mut speech_detected = false;
        let mut silence_frames = 0;
        
        while is_rec.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(33));
            
            let samples: Vec<f32> = {
                let lock = captured.lock().unwrap();
                let len = lock.len();
                if len >= FFT_SIZE {
                    lock[len - FFT_SIZE..].to_vec()
                } else {
                    let mut pad = vec![0.0; FFT_SIZE - len];
                    pad.extend_from_slice(&lock);
                    pad
                }
            };
            
            let levels = extract_levels(&fft, &samples);
            let _ = app_handle.emit("levels", levels);
            
            // VAD logic: stop recording after 1.5s of silence
            let max_level = levels.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            if max_level > 0.015 {
                speech_detected = true;
                silence_frames = 0;
            } else if speech_detected {
                silence_frames += 1;
                if silence_frames > 45 {
                    stop_and_transcribe(&app_handle);
                    break;
                }
            }
        }
    });
}

fn stop_and_transcribe(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    println!("Stopping recording...");
    
    state.is_recording.store(false, Ordering::SeqCst);
    let _ = state.audio_tx.send(AudioCommand::Stop);
    
    let _ = app.emit("levels", [0.0; 5]);
    
    let raw = state.captured.lock().unwrap().clone();
    if raw.is_empty() {
        let _ = app.emit("patter://state", "Idle");
        return;
    }
    
    let _ = app.emit("patter://state", "Transcribing...");
    
    let channels = state.device_config.lock().unwrap().channels() as usize;
    let src_rate = state.device_config.lock().unwrap().sample_rate().0;
    let engine_arc = state.engine.clone();
    let app_handle = app.clone();
    
    thread::spawn(move || {
        let mono: Vec<f32> = if channels > 1 {
            raw.chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect()
        } else {
            raw
        };
        let audio = resample_linear(&mono, src_rate, WHISPER_SAMPLE_RATE);
        
        if audio.len() < WHISPER_SAMPLE_RATE as usize {
             let _ = app_handle.emit("patter://state", "Audio too short");
             thread::sleep(Duration::from_secs(1));
             let _ = app_handle.emit("patter://state", "Idle");
             return;
        }

        let prompt = app_handle.state::<AppState>().custom_prompt.lock().unwrap().clone();
        let text = {
            let mut lock = engine_arc.lock().unwrap();
            if let Some(engine) = lock.as_mut() {
                match engine.transcribe(&audio, if prompt.is_empty() { None } else { Some(&prompt) }) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Inference failed: {}", e);
                        let _ = app_handle.emit("patter://state", "Idle");
                        return;
                    }
                }
            } else {
                let _ = app_handle.emit("patter://state", "No model loaded");
                thread::sleep(Duration::from_secs(1));
                let _ = app_handle.emit("patter://state", "Idle");
                return;
            }
        };
        
        println!("Transcript: {}", text);
        if text.is_empty() {
             let _ = app_handle.emit("patter://state", "Idle");
             return;
        }

        let word_count = text.split_whitespace().count();
        let duration_seconds = audio.len() as f32 / WHISPER_SAMPLE_RATE as f32;
        
        let db = db::Db::new(&app_handle);
        db.add_record(db::TranscriptionRecord {
            id: String::new(),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            text: text.clone(),
            duration_seconds,
            words: word_count as u32,
        });
        let _ = app_handle.emit("patter://db_updated", ());

        let _ = app_handle.emit("patter://state", format!("✓ Pasted · {} words", word_count));
        
        let mode = app_handle.state::<AppState>().output_mode.lock().unwrap().clone();
        
        let _ = app_handle.run_on_main_thread(move || {
            if mode == "type" {
                if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                    let _ = enigo.text(&text);
                }
            } else {
                if let Ok(mut clipboard) = Clipboard::new() {
                    let _ = clipboard.set_text(text);
                    
                    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                        let _ = enigo.key(Key::Meta, Direction::Press);
                        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
                        let _ = enigo.key(Key::Meta, Direction::Release);
                    }
                }
            }
        });

        thread::sleep(Duration::from_millis(1500));
        let _ = app_handle.emit("patter://state", "Idle");
    });
}

fn main() {

    let (tx, rx) = std::sync::mpsc::channel::<AudioCommand>();
    
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
                AudioCommand::Start(captured) => {
                    if stream.is_none() {
                        let host = cpal::default_host();
                        if let Some(dev) = host.default_input_device() {
                            if let Ok(cfg) = dev.default_input_config() {
                                *thread_config.lock().unwrap() = cfg.clone();
                                if let Ok(s) = create_stream(&dev, &cfg, captured, tx_for_audio.clone()) {
                                    s.play().unwrap();
                                    stream = Some(s);
                                }
                            }
                        }
                    }
                }
                AudioCommand::Stop => {
                    stream = None;
                }
                AudioCommand::Reconnect(captured) => {
                    eprintln!("Audio stream failed. Reconnecting...");
                    stream = None;
                    
                    let host = cpal::default_host();
                    if let Some(dev) = host.default_input_device() {
                        if let Ok(cfg) = dev.default_input_config() {
                            *thread_config.lock().unwrap() = cfg.clone();
                            if let Ok(s) = create_stream(&dev, &cfg, captured, tx_for_audio.clone()) {
                                s.play().unwrap();
                                stream = Some(s);
                                eprintln!("Reconnected successfully.");
                            }
                        }
                    }
                }
            }
        }
    });

    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let dashboard_i = MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "dashboard" => {
                        let _ = open_dashboard(app.clone());
                    }
                    _ => {}
                })
                .build(app)?;

            let model_manager = models::registry::ModelManager::new(app.handle())?;
            let mut initial_engine: Option<Box<dyn asr::ASREngine>> = None;
            
            // Try loading whisper on startup if available to keep the old flow working
            if let Ok(whisper) = asr::whisper::WhisperEngine::new("models/ggml-base.en.bin") {
                initial_engine = Some(Box::new(whisper));
            }
            
            let app_state = AppState {
                captured: Arc::new(Mutex::new(Vec::new())),
                audio_tx: tx,
                device_config: shared_config.clone(),
                is_recording: Arc::new(AtomicBool::new(false)),
                engine: Arc::new(Mutex::new(initial_engine)),
                model_manager,
                output_mode: Arc::new(Mutex::new("paste".to_string())),
                custom_prompt: Arc::new(Mutex::new(String::new())),
            };

            app.manage(app_state);

            app.global_shortcut()
                .register("Alt+Space".parse::<tauri_plugin_global_shortcut::Shortcut>().unwrap())?;
            
            let panel = PanelBuilder::<_, HUDPanel>::new(app.handle(), "main")
                .url(WebviewUrl::App("hud.html".into()))
                .level(PanelLevel::Floating)
                .transparent(true)
                .with_window(|window| {
                    window
                        .transparent(true)
                        .decorations(false)
                        .always_on_top(true)
                        .resizable(false)
                        .inner_size(320.0, 88.0)
                })
                .build()?;
            
            let window = app.get_webview_window("main").unwrap();
            if let Some(monitor) = window.primary_monitor()? {
                let size = monitor.size();
                let window_size = window.outer_size()?;
                let y = (size.height as f64 * 0.85) as i32;
                let x = ((size.width as i32) - (window_size.width as i32)) / 2;
                window.set_position(tauri::PhysicalPosition::new(x, y))?;
            }
            
            panel.show();

            Ok(())
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let state = app.state::<AppState>();
                        if state.is_recording.load(Ordering::SeqCst) {
                            stop_and_transcribe(app);
                        } else {
                            start_recording(app);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            download_model,
            set_engine,
            set_output_mode,
            set_custom_prompt,
            get_stats,
            get_history,
            clear_history,
            open_dashboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}