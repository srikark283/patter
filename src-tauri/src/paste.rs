use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

pub fn paste_text(mode: &str, text: &str) {
    if mode == "type" {
        if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
            let _ = enigo.text(text);
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
}
