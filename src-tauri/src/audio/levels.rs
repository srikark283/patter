use rustfft::{num_complex::Complex, Fft};
use std::sync::Arc;

pub const FFT_SIZE: usize = 128;

pub fn extract_levels(fft: &Arc<dyn Fft<f32>>, samples: &[f32]) -> [f32; 5] {
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
