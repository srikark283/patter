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
    /// Not an ASR engine — speaker diarization models for meetings.
    Diarization,
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
    // Diarization pair: pyannote segmentation + speaker embedding. Sizes
    // verified via `curl -sIL` Content-Length, same as the entries above.
    ModelVariant {
        id: "diar-segmentation",
        engine: EngineKind::Diarization,
        base_url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main",
        dest_subdir: "diarization",
        files: &[ModelFile { name: "model.onnx", size: 5_992_913 }],
    },
    ModelVariant {
        id: "diar-embedding",
        engine: EngineKind::Diarization,
        base_url: "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main",
        dest_subdir: "diarization",
        files: &[ModelFile { name: "nemo_en_titanet_small.onnx", size: 40_257_283 }],
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

/// Mirror of every catalog file on the app's own GitHub release, for networks
/// where huggingface.co is blocked (corporate proxies often block the AI/ML
/// category wholesale). Assets are prefixed with the variant id because
/// parakeet v2/v3 file names collide.
const MIRROR_BASE: &str = "https://github.com/srikark283/patter/releases/download/models-v1";

fn mirror_url(variant_id: &str, file_name: &str) -> String {
    format!("{}/{}-{}", MIRROR_BASE, variant_id, file_name)
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

    /// Downloaded ASR engines only (feeds the tray model switcher).
    pub fn downloaded_ids(&self) -> Vec<&'static str> {
        CATALOG
            .iter()
            .filter(|v| v.engine != EngineKind::Diarization && self.is_downloaded(v.id))
            .map(|v| v.id)
            .collect()
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

        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Patter/0.2.1")
            .build()?;
        let total_bytes: f64 = variant.files.iter().map(|f| f.size as f64).sum();
        let mut overall_downloaded = 0f64;
        let mut last_emitted_pct = -1.0f64;

        for file in variant.files {
            let dest_path = dir.join(file.name);
            if dest_path.exists() && std::fs::metadata(&dest_path).map(|m| m.len()).unwrap_or(0) == file.size {
                overall_downloaded += file.size as f64;
                continue;
            }

            // Primary source first, then the GitHub mirror (see MIRROR_BASE).
            let urls = [
                format!("{}/{}?download=true", variant.base_url, file.name),
                mirror_url(variant.id, file.name),
            ];
            let mut last_err: Option<anyhow::Error> = None;
            let mut done = false;
            for url in &urls {
                let attempt = async {
                    let res = client.get(url).send().await?;
                    if !res.status().is_success() {
                        bail!("HTTP {}", res.status());
                    }
                    let mut written = 0f64;
                    let mut stream = res.bytes_stream();
                    let mut out = File::create(&dest_path)?;
                    let result: Result<()> = async {
                        while let Some(item) = stream.next().await {
                            let chunk = item?;
                            out.write_all(&chunk)?;
                            written += chunk.len() as f64;
                            overall_downloaded += chunk.len() as f64;

                            let pct = (overall_downloaded / total_bytes).min(0.99);
                            if pct - last_emitted_pct >= 0.01 {
                                progress_callback(pct as f32);
                                last_emitted_pct = pct;
                            }
                        }
                        Ok(())
                    }
                    .await;
                    if result.is_err() {
                        // Roll back the partial file so the next source restarts clean.
                        overall_downloaded -= written;
                        let _ = std::fs::remove_file(&dest_path);
                    }
                    result
                };
                match attempt.await {
                    Ok(()) => {
                        done = true;
                        break;
                    }
                    Err(e) => {
                        eprintln!("[models] {} failed from {}: {}", file.name, url, e);
                        last_err = Some(e);
                    }
                }
            }
            if !done {
                bail!(
                    "Failed to download {} from all sources: {}",
                    file.name,
                    last_err.map(|e| e.to_string()).unwrap_or_default()
                );
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
