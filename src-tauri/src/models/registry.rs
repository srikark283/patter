use anyhow::{bail, Result};
use futures_util::StreamExt;
use reqwest::Client;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

#[derive(serde::Serialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub pct: f32,
}

pub struct ModelManager {
    models_dir: PathBuf,
}

impl ModelManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self> {
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("~/Library/Application Support/Patter"));
        let models_dir = app_dir.join("models");
        std::fs::create_dir_all(&models_dir)?;
        Ok(Self { models_dir })
    }

    pub fn get_models_dir(&self) -> PathBuf {
        self.models_dir.clone()
    }

    pub async fn download_parakeet<F>(&self, progress_callback: F) -> Result<()>
    where
        F: Fn(f32) + Send + 'static,
    {
        let model_id = "parakeet-tdt";
        let parakeet_dir = self.models_dir.join(model_id);
        std::fs::create_dir_all(&parakeet_dir)?;

        let base_url = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main";
        
        let files = vec![
            ("encoder.int8.onnx", 652184281f32),
            ("decoder.int8.onnx", 11845275f32),
            ("joiner.int8.onnx", 6355277f32),
            ("tokens.txt", 93939f32),
        ];

        let client = Client::new();
        let total_bytes: f32 = files.iter().map(|(_, size)| size).sum();
        let mut overall_downloaded = 0f32;

        for (file, expected_size) in files {
            let url = format!("{}/{}?download=true", base_url, file);
            let dest_path = parakeet_dir.join(file);
            
            if dest_path.exists() {
                overall_downloaded += expected_size;
                continue;
            }

            let res = client.get(&url).send().await?;
            if !res.status().is_success() {
                bail!("Failed to download {}: HTTP {}", file, res.status());
            }

            let mut stream = res.bytes_stream();
            let mut out = File::create(&dest_path)?;

            let mut last_emitted_pct = -1.0;
            let mut current_file_downloaded = 0f32;
            
            while let Some(item) = stream.next().await {
                let chunk = item?;
                out.write_all(&chunk)?;
                let chunk_len = chunk.len() as f32;
                current_file_downloaded += chunk_len;
                overall_downloaded += chunk_len;
                
                let overall_pct = overall_downloaded / total_bytes;
                
                if overall_pct - last_emitted_pct >= 0.01 {
                    println!("Emitting progress: {}", overall_pct);
                    progress_callback(overall_pct);
                    last_emitted_pct = overall_pct;
                }
            }
        }
        
        progress_callback(1.0);
        Ok(())
    }
}
