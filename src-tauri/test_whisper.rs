fn main() {
    let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
    params.set_no_context(true);
    params.set_entropy_thold(2.4);
    params.set_no_speech_thold(0.6);
    params.set_single_segment(false);
}
