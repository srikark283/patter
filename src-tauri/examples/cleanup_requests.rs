//! Export production cleanup requests for the offline evaluation runner.
#[allow(dead_code)]
#[path = "../src/ollama.rs"]
mod ollama;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<serde_json::Value> = serde_json::from_reader(std::io::stdin())?;
    let requests: Vec<_> = cases.iter().map(|case| {
        let messages = ollama::cleanup_messages(
            case["input"].as_str().expect("case input"), case["context"].as_str(),
        );
        ollama::chat_request("MODEL", messages, 30)
    }).collect();
    println!("{}", serde_json::to_string(&requests)?);
    Ok(())
}
