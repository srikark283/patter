//! Spectral shaping for whispered speech.
//!
//! Whispering has no vocal-fold vibration, so all of its information lives in
//! turbulent noise: fricatives, formant shape, and consonant bursts, mostly
//! above 2kHz. Meanwhile the low end carries nothing but HVAC rumble and desk
//! thump, which the mel filterbank's lowest bins happily hand to the model.
//! Cutting the bottom and lifting the top moves the audio closer to what every
//! ASR model was actually trained on, which is why this helps regardless of
//! which engine is loaded.

/// RBJ audio-EQ-cookbook biquad, Direct Form I.
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn new(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn high_pass(rate: f32, freq: f32, q: f32) -> Self {
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let (sin, cos) = (w0.sin(), w0.cos());
        let alpha = sin / (2.0 * q);
        Self::new(
            (1.0 + cos) / 2.0,
            -(1.0 + cos),
            (1.0 + cos) / 2.0,
            1.0 + alpha,
            -2.0 * cos,
            1.0 - alpha,
        )
    }

    /// Shelf with slope S = 1 (the cookbook's gentlest non-resonant shape).
    fn high_shelf(rate: f32, freq: f32, gain_db: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let (sin, cos) = (w0.sin(), w0.cos());
        let alpha = sin / 2.0 * std::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        Self::new(
            a * ((a + 1.0) + (a - 1.0) * cos + two_sqrt_a_alpha),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
            a * ((a + 1.0) + (a - 1.0) * cos - two_sqrt_a_alpha),
            (a + 1.0) - (a - 1.0) * cos + two_sqrt_a_alpha,
            2.0 * ((a - 1.0) - (a + 1.0) * cos),
            (a + 1.0) - (a - 1.0) * cos - two_sqrt_a_alpha,
        )
    }

    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// Nothing intelligible in whispered speech lives below this.
const HIGHPASS_HZ: f32 = 100.0;
/// Where the consonant information starts.
const SHELF_HZ: f32 = 2000.0;
const SHELF_GAIN_DB: f32 = 6.0;
/// Headroom kept after filtering, since a shelf boost raises peaks.
const PEAK_CEILING: f32 = 0.95;

/// Rumble cut plus a high shelf, tuned for whispering. `rate` is the sample
/// rate of `audio`; the result is peak-limited so the boost can't clip.
pub fn whisper_tilt(audio: &[f32], rate: u32) -> Vec<f32> {
    let mut hp = Biquad::high_pass(rate as f32, HIGHPASS_HZ, std::f32::consts::FRAC_1_SQRT_2);
    let mut shelf = Biquad::high_shelf(rate as f32, SHELF_HZ, SHELF_GAIN_DB);

    let mut out: Vec<f32> = audio
        .iter()
        .map(|&s| {
            let y = shelf.run(hp.run(s));
            // A denormal or a NaN here would poison the whole ASR input.
            if y.is_finite() {
                y
            } else {
                0.0
            }
        })
        .collect();

    let peak = out.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if peak > PEAK_CEILING {
        let scale = PEAK_CEILING / peak;
        for s in out.iter_mut() {
            *s *= scale;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    /// Peak amplitude of a filtered 1-second sine at `freq`, ignoring the first
    /// 100ms so the filter's transient doesn't count.
    fn response(freq: f32) -> f32 {
        let tone: Vec<f32> = (0..RATE)
            .map(|i| {
                (2.0 * std::f32::consts::PI * freq * i as f32 / RATE as f32).sin() * 0.3
            })
            .collect();
        let out = whisper_tilt(&tone, RATE);
        out[RATE as usize / 10..]
            .iter()
            .map(|s| s.abs())
            .fold(0.0f32, f32::max)
    }

    #[test]
    fn tilt_cuts_rumble_and_lifts_consonants() {
        let rumble = response(50.0);
        let mid = response(1000.0);
        let consonants = response(4000.0);

        // 50Hz is an octave below the corner: well down, and never inverted.
        assert!(rumble < mid * 0.3, "rumble {rumble} vs mid {mid}");
        // The shelf is +6dB, so 4kHz should land clearly above 1kHz.
        assert!(consonants > mid * 1.5, "4k {consonants} vs 1k {mid}");
        // Mid stays roughly where it was — this is a tilt, not a gain stage.
        assert!((mid - 0.3).abs() < 0.1, "mid was {mid}");
    }

    #[test]
    fn tilt_never_clips_or_emits_nan() {
        // Bass-heavy signal at full scale: the shelf boost would overshoot.
        let loud: Vec<f32> = (0..RATE)
            .map(|i| (2.0 * std::f32::consts::PI * 3000.0 * i as f32 / RATE as f32).sin())
            .collect();
        let out = whisper_tilt(&loud, RATE);
        assert!(out.iter().all(|s| s.is_finite()));
        assert!(out.iter().map(|s| s.abs()).fold(0.0f32, f32::max) <= PEAK_CEILING + 1e-6);

        assert!(whisper_tilt(&[], RATE).is_empty());
    }
}
