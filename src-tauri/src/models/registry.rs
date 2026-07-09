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

#[derive(Clone, Copy, PartialEq)]
pub enum EngineKind {
    Whisper,
    Parakeet,
}

pub struct ModelFile {
    pub name: &'static str,
    pub size: u64,
}

pub struct ModelVariant {
    pub id: &'static str,
    pub engine: EngineKind,
    pub base_url: &'static str,
    pub dest_subdir: &'static str,
    pub files: &'static [ModelFile],
}

// All URLs/sizes verified against Hugging Face via `curl -sI` — real Content-Length,
// not guessed. Whisper variants share one `whisper/` dir (distinct filenames);
// Parakeet variants get their own dir each since their 3 ONNX files are identically
// named across v2/v3 and would otherwise collide.
const CATALOG: &[ModelVariant] = &[
    ModelVariant {
        id: "whisper-tiny",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-tiny.en.bin", size: 77_704_715 }],
    },
    ModelVariant {
        id: "whisper-base",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-base.en.bin", size: 147_964_211 }],
    },
    ModelVariant {
        id: "whisper-small",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-small.en.bin", size: 487_614_201 }],
    },
    ModelVariant {
        id: "whisper-large-v3-turbo",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-large-v3-turbo.bin", size: 1_624_555_275 }],
    },
    ModelVariant {
        id: "parakeet-v2",
        engine: EngineKind::Parakeet,
        base_url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main",
        dest_subdir: "parakeet-v2",
        files: &[
            ModelFile { name: "encoder.int8.onnx", size: 652_184_296 },
            ModelFile { name: "decoder.int8.onnx", size: 7_257_753 },
            ModelFile { name: "joiner.int8.onnx", size: 1_739_080 },
            ModelFile { name: "tokens.txt", size: 9_384 },
        ],
    },
    ModelVariant {
        id: "parakeet-v3",
        engine: EngineKind::Parakeet,
        base_url: "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main",
        dest_subdir: "parakeet-v3",
        files: &[
            ModelFile { name: "encoder.int8.onnx", size: 652_184_281 },
            ModelFile { name: "decoder.int8.onnx", size: 11_845_275 },
            ModelFile { name: "joiner.int8.onnx", size: 6_355_277 },
            ModelFile { name: "tokens.txt", size: 93_939 },
        ],
    },
];

fn find_variant(id: &str) -> Option<&'static ModelVariant> {
    CATALOG.iter().find(|v| v.id == id)
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

    pub fn get_engine_kind(&self, id: &str) -> Option<EngineKind> {
        find_variant(id).map(|v| v.engine)
    }

    /// Whisper variants are a single file — the path whisper-rs should load.
    pub fn variant_file_path(&self, id: &str) -> Option<PathBuf> {
        let variant = find_variant(id)?;
        let file = variant.files.first()?;
        Some(self.models_dir.join(variant.dest_subdir).join(file.name))
    }

    /// Parakeet variants are a directory of files — the dir sherpa-onnx should load.
    pub fn variant_dir(&self, id: &str) -> Option<PathBuf> {
        let variant = find_variant(id)?;
        Some(self.models_dir.join(variant.dest_subdir))
    }

    pub fn is_downloaded(&self, id: &str) -> bool {
        match find_variant(id) {
            Some(variant) => {
                let dir = self.models_dir.join(variant.dest_subdir);
                variant.files.iter().all(|f| {
                    let path = dir.join(f.name);
                    path.exists() && std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) == f.size
                })
            }
            None => false,
        }
    }

    pub async fn download_variant<F>(&self, id: &str, progress_callback: F) -> Result<()>
    where
        F: Fn(f32) + Send + 'static,
    {
        let variant = find_variant(id).ok_or_else(|| anyhow::anyhow!("Unknown model: {id}"))?;
        let dir = self.models_dir.join(variant.dest_subdir);
        std::fs::create_dir_all(&dir)?;

        let client = Client::new();
        let total_bytes: f64 = variant.files.iter().map(|f| f.size as f64).sum();
        let mut overall_downloaded = 0f64;
        let mut last_emitted_pct = -1.0f64;

        for file in variant.files {
            let dest_path = dir.join(file.name);
            if dest_path.exists() && std::fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0) == file.size {
                overall_downloaded += file.size as f64;
                continue;
            }

            let url = format!("{}/{}?download=true", variant.base_url, file.name);
            let res = client.get(&url).send().await?;
            if !res.status().is_success() {
                bail!("Failed to download {}: HTTP {}", file.name, res.status());
            }

            let mut stream = res.bytes_stream();
            let mut out = File::create(&dest_path)?;

            while let Some(item) = stream.next().await {
                let chunk = item?;
                out.write_all(&chunk)?;
                overall_downloaded += chunk.len() as f64;

                let pct = (overall_downloaded / total_bytes).min(0.99);
                if pct - last_emitted_pct >= 0.01 {
                    progress_callback(pct as f32);
                    last_emitted_pct = pct;
                }
            }
        }

        progress_callback(1.0);
        Ok(())
    }

    pub fn delete_variant(&self, id: &str) -> Result<()> {
        let variant = find_variant(id).ok_or_else(|| anyhow::anyhow!("Unknown model: {id}"))?;
        let dir = self.models_dir.join(variant.dest_subdir);
        for file in variant.files {
            let path = dir.join(file.name);
            if path.exists() {
                std::fs::remove_file(path)?;
            }
        }
        // Attempt to remove the directory if empty (safe to ignore error if other files exist)
        let _ = std::fs::remove_dir(dir);
        Ok(())
    }
}
