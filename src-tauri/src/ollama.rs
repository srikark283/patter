use serde::Deserialize;
use std::time::Duration;

const OLLAMA_URL: &str = "http://localhost:11434";

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    name: String,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

/// List locally downloaded Ollama models. Errors if Ollama isn't running.
pub fn list_models() -> Result<Vec<String>, String> {
    let resp: TagsResponse = reqwest::blocking::Client::new()
        .get(format!("{}/api/tags", OLLAMA_URL))
        .timeout(Duration::from_secs(3))
        .send()
        .map_err(|e| format!("Ollama not reachable: {}", e))?
        .json()
        .map_err(|e| format!("Bad response from Ollama: {}", e))?;
    Ok(resp.models.into_iter().map(|m| m.name).collect())
}

/// Clean up a raw transcript with a local Ollama model. Returns cleaned text.
pub fn cleanup(model: &str, text: &str) -> Result<String, String> {
    let prompt = format!(
        "Clean up this voice transcript: fix punctuation, capitalization, and grammar; \
         remove filler words (um, uh, like, you know) and false starts. \
         Do not change the meaning, do not add content, do not summarize. \
         Reply with ONLY the cleaned text.\n\nTranscript:\n{}",
        text
    );
    let resp: GenerateResponse = reqwest::blocking::Client::new()
        .post(format!("{}/api/generate", OLLAMA_URL))
        .timeout(Duration::from_secs(60))
        .json(&serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
        }))
        .send()
        .map_err(|e| format!("Ollama not reachable: {}", e))?
        .json()
        .map_err(|e| format!("Bad response from Ollama: {}", e))?;
    let cleaned = resp.response.trim().to_string();
    if cleaned.is_empty() {
        return Err("Ollama returned empty text".to_string());
    }
    Ok(cleaned)
}
