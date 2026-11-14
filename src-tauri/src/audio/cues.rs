use crate::db::Settings;
use rodio::{Decoder, OutputStream, Sink};
use std::io::Cursor;
use std::sync::{mpsc, OnceLock};

#[derive(Clone, Copy)]
pub enum Cue {
    Start,
    Stop,
}

pub fn play(settings: &Settings, cue: Cue) {
    if !settings.play_sounds {
        return;
    }
    let samples: &'static [u8] = match settings.sound_theme.as_str() {
        "chime" => include_bytes!("../../../public/sounds/chime.wav"),
        "wood" => include_bytes!("../../../public/sounds/wood.wav"),
        "pluck" => include_bytes!("../../../public/sounds/pluck.wav"),
        _ => include_bytes!("../../../public/sounds/pop.wav"),
    };
    let speed = match cue {
        Cue::Start => 1.5,
        Cue::Stop => 0.9,
    };

    static PLAYER: OnceLock<mpsc::Sender<(&'static [u8], f32)>> = OnceLock::new();
    let player = PLAYER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            while let Ok((samples, speed)) = rx.recv() {
                if let Err(error) = play_to_default_output(samples, speed) {
                    eprintln!("Dictation sound failed: {error}");
                }
            }
        });
        tx
    });
    let _ = player.send((samples, speed));
}

fn play_to_default_output(samples: &'static [u8], speed: f32) -> anyhow::Result<()> {
    let (_stream, handle) = OutputStream::try_default()?;
    let sink = Sink::try_new(&handle)?;
    sink.set_speed(speed);
    sink.append(Decoder::new_wav(Cursor::new(samples))?);
    sink.sleep_until_end();
    Ok(())
}
