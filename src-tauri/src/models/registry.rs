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

#[derive(serde::Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelState {
    Missing,
    Partial,
    Complete,
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
    // Multilingual counterparts of the three `.en` builds above. Same
    // architecture and size class — the `.en` weights are simply trained on
    // English only, which is the entire reason Patter was English-only. Whisper
    // covers 99 languages; these are the weights that do it.
    ModelVariant {
        id: "whisper-tiny-multi",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-tiny.bin", size: 77_691_713 }],
    },
    ModelVariant {
        id: "whisper-base-multi",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-base.bin", size: 147_951_465 }],
    },
    ModelVariant {
        id: "whisper-small-multi",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-small.bin", size: 487_601_967 }],
    },
    ModelVariant {
        id: "whisper-medium-multi",
        engine: EngineKind::Whisper,
        base_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
        dest_subdir: "whisper",
        files: &[ModelFile { name: "ggml-medium.bin", size: 1_533_763_059 }],
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

/// Every catalog id, diarization pair included — callers that only want ASR
/// engines filter with `get_engine_kind`.
pub fn all_ids() -> Vec<&'static str> {
    CATALOG.iter().map(|v| v.id).collect()
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

    /// `Complete` = every file present at its catalog size. `Partial` = bytes on
    /// disk that don't add up: an interrupted download from before `.part`
    /// staging, or a catalog size that has since moved. `Missing` = nothing there.
    ///
    /// The distinction matters because `Partial` looks identical to `Missing` in
    /// the UI while still occupying the disk — a 338MB fragment of a 1.6GB model
    /// reads as "not downloaded" and never gets reclaimed.
    pub fn state(&self, id: &str) -> ModelState {
        let Some(variant) = find_variant(id) else {
            return ModelState::Missing;
        };
        let dir = self.models_dir.join(variant.dest_subdir);
        let (mut present, mut correct) = (0, 0);
        for f in variant.files {
            let path = dir.join(f.name);
            let len = std::fs::metadata(&path).map(|m| m.len()).ok();
            if let Some(len) = len {
                present += 1;
                if len == f.size {
                    correct += 1;
                }
            } else if dir.join(format!("{}.part", f.name)).exists() {
                present += 1;
            }
        }
        if correct == variant.files.len() {
            ModelState::Complete
        } else if present > 0 {
            ModelState::Partial
        } else {
            ModelState::Missing
        }
    }

    /// Bytes a `Partial` model is occupying, so the UI can say what reclaiming it buys.
    pub fn stray_bytes(&self, id: &str) -> u64 {
        let Some(variant) = find_variant(id) else { return 0 };
        let dir = self.models_dir.join(variant.dest_subdir);
        variant
            .files
            .iter()
            .flat_map(|f| [dir.join(f.name), dir.join(format!("{}.part", f.name))])
            .filter_map(|p| std::fs::metadata(p).map(|m| m.len()).ok())
            .sum()
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
            // Stage under `.part` and rename only once the bytes are all here.
            // Writing straight to `dest_path` means a crash or a quit mid-download
            // leaves a short file at the real name, which `state` can only report
            // as broken and which nothing ever cleans up. A `.part` file is
            // unambiguous and gets truncated by the next attempt.
            let part_path = dir.join(format!("{}.part", file.name));
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
                    let mut out = File::create(&part_path)?;
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
                        let _ = std::fs::remove_file(&part_path);
                        return result;
                    }
                    // Only a fully-written file earns the real name. Reject a
                    // short body that streamed without error — a truncated
                    // model loads and produces garbage rather than failing loudly.
                    let got = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
                    if got != file.size {
                        let _ = std::fs::remove_file(&part_path);
                        overall_downloaded -= written;
                        bail!("{} is {} bytes, expected {}", file.name, got, file.size);
                    }
                    std::fs::rename(&part_path, &dest_path)?;
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
            // `.part` too, so deleting an interrupted download actually reclaims
            // the disk rather than leaving the staged fragment behind.
            for path in [dir.join(file.name), dir.join(format!("{}.part", file.name))] {
                if path.exists() {
                    std::fs::remove_file(path)?;
                }
            }
        }
        // Attempt to remove the directory if empty (safe to ignore error if other files exist)
        let _ = std::fs::remove_dir(dir);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A truncated file must read as `Partial`, not `Missing`. Reporting it as
    /// missing is what let a 338MB fragment of a 1.6GB model sit unnoticed:
    /// invisible in the UI, still occupying the disk, silently excluded from
    /// every model picker.
    #[test]
    fn truncated_downloads_report_as_partial_not_missing() {
        let dir = std::env::temp_dir().join(format!("patter_state_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mm = ModelManager { models_dir: dir.clone() };
        let variant = find_variant("whisper-base").unwrap();
        let file = &variant.files[0];
        let path = dir.join(variant.dest_subdir).join(file.name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();

        assert_eq!(mm.state("whisper-base"), ModelState::Missing);
        assert_eq!(mm.stray_bytes("whisper-base"), 0);

        std::fs::write(&path, vec![0u8; 1024]).unwrap();
        assert_eq!(mm.state("whisper-base"), ModelState::Partial);
        assert_eq!(mm.stray_bytes("whisper-base"), 1024);

        std::fs::write(&path, vec![0u8; file.size as usize]).unwrap();
        assert_eq!(mm.state("whisper-base"), ModelState::Complete);

        // A `.part` alone is Partial too — an interrupted download mid-stage.
        std::fs::remove_file(&path).unwrap();
        std::fs::write(path.with_file_name(format!("{}.part", file.name)), vec![0u8; 64]).unwrap();
        assert_eq!(mm.state("whisper-base"), ModelState::Partial);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Multi-file models (Parakeet) are only Complete when every file is right.
    #[test]
    fn a_multi_file_model_is_incomplete_until_every_file_lands() {
        let dir = std::env::temp_dir().join(format!("patter_multi_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mm = ModelManager { models_dir: dir.clone() };
        let variant = find_variant("parakeet-v2").unwrap();
        let vdir = dir.join(variant.dest_subdir);
        std::fs::create_dir_all(&vdir).unwrap();

        // Everything but the largest file, all at correct sizes.
        for f in variant.files.iter().filter(|f| f.size < 100_000) {
            std::fs::write(vdir.join(f.name), vec![0u8; f.size as usize]).unwrap();
        }
        assert_eq!(mm.state("parakeet-v2"), ModelState::Partial);
        assert!(!mm.is_downloaded("parakeet-v2"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
