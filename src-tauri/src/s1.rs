//! App-owned S1-mini process. Only model installation uses the network.
use crate::inference::BuiltInModel;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Deserialize)]
struct Manifest {
    repo: String,
    revision: String,
    files: Vec<ModelFile>,
}
#[derive(Deserialize)]
struct ModelFile {
    name: String,
    size: u64,
    sha256: String,
}
fn manifest(model: BuiltInModel) -> Manifest {
    let json = match model {
        BuiltInModel::S1Mini => include_str!("../../native/s1-mini/model.json"),
    };
    serde_json::from_str(json).expect("built-in model manifest")
}
#[derive(Clone)]
struct Paths {
    kind: BuiltInModel,
    model: PathBuf,
    executable: PathBuf,
}
static PATHS: OnceLock<Paths> = OnceLock::new();
static WORKER: Mutex<Option<Worker>> = Mutex::new(None);
static CHILD: Mutex<Option<Arc<Mutex<Child>>>> = Mutex::new(None);
static DOWNLOADING: AtomicU32 = AtomicU32::new(0);
static PROGRESS: AtomicU32 = AtomicU32::new(0);

pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let bundled = app.path().resource_dir()?.join("s1-runtime/patter-s1");
    let executable = if cfg!(debug_assertions) && !bundled.is_file() {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/s1-mini/dist/patter-s1")
    } else {
        bundled
    };
    let _ = PATHS.set(Paths {
        kind: BuiltInModel::S1Mini,
        model: app.path().app_data_dir()?.join("models"),
        executable,
    });
    Ok(())
}
fn paths(model: BuiltInModel) -> Result<Paths, String> {
    let mut p = PATHS
        .get()
        .ok_or("Built-in runtime is not initialized")?
        .clone();
    p.kind = model;
    p.model = p.model.join("s1-mini").join(manifest(model).revision);
    Ok(p)
}
fn supported() -> bool {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return false;
    }
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().split('.').next()?.parse::<u32>().ok())
            .is_some_and(|v| v >= 14)
    })
}
fn installed_at(model: BuiltInModel, dir: &Path) -> bool {
    dir.join(".complete").is_file()
        && manifest(model)
            .files
            .iter()
            .all(|f| fs::metadata(dir.join(&f.name)).is_ok_and(|m| m.len() == f.size))
}
#[derive(Serialize)]
pub struct Status {
    pub supported: bool,
    pub installed: bool,
    pub runtime_ready: bool,
    pub downloading: bool,
    pub progress: u32,
    pub download_bytes: u64,
    pub downloading_model: Option<BuiltInModel>,
}
pub fn status(model: BuiltInModel) -> Result<Status, String> {
    let p = paths(model)?;
    Ok(Status {
        supported: supported(),
        installed: installed_at(model, &p.model),
        runtime_ready: p.executable.is_file()
            && p.executable.with_file_name("mlx.metallib").is_file(),
        downloading: DOWNLOADING.load(Ordering::Relaxed) != 0,
        downloading_model: match DOWNLOADING.load(Ordering::Relaxed) {
            1 => Some(BuiltInModel::S1Mini),
            _ => None,
        },
        download_bytes: manifest(model).files.iter().map(|f| f.size).sum(),
        progress: PROGRESS.load(Ordering::Relaxed),
    })
}
/// All settings entry points share this gate; the UI alone must not activate
/// missing models or cleanup in a language this model cannot normalize.
pub fn validate_settings(settings: &crate::db::Settings) -> Result<(), String> {
    if !settings.llm_cleanup_enabled
        || settings.cleanup_provider != crate::inference::CleanupProvider::BuiltIn
    {
        return Ok(());
    }
    activation_ready(settings, &status(BuiltInModel::S1Mini)?)
}
fn activation_ready(settings: &crate::db::Settings, status: &Status) -> Result<(), String> {
    if !status.supported {
        return Err(
            "S1-mini requires Apple Silicon and macOS 14 or newer. Choose Ollama for this device."
                .into(),
        );
    }
    if !status.runtime_ready {
        return Err("The S1-mini runtime is missing. Reinstall Patter and retry.".into());
    }
    if !status.installed {
        return Err("Set up S1-mini in Intelligence before enabling cleanup.".into());
    }
    if settings.language != "en" {
        return Err("S1-mini requires English. Choose Ollama or turn off S1-mini cleanup before changing transcription language.".into());
    }
    Ok(())
}
fn require_supported() -> Result<(), String> {
    if supported() {
        Ok(())
    } else {
        Err("Built-in MLX requires Apple Silicon and macOS 14 or newer".into())
    }
}
fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
struct DownloadGuard;
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        DOWNLOADING.store(0, Ordering::Release);
    }
}
pub fn install(model: BuiltInModel) -> Result<(), String> {
    require_supported()?;
    if DOWNLOADING
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Err("A built-in model is already downloading".into());
    }
    let _guard = DownloadGuard;
    PROGRESS.store(0, Ordering::Relaxed);
    let p = paths(model)?;
    if !p.executable.is_file() {
        return Err("The built-in runtime is missing. Reinstall Patter or run npm run build:s1 in development.".into());
    }
    install_into(model, &p.model).map_err(|e| format!("{} download failed: {e}", model.name()))
}
fn install_into(model: BuiltInModel, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(dir)?;
    let m = manifest(model);
    let total: u64 = m.files.iter().map(|f| f.size).sum();
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(1800))
        .build()?;
    let mut completed = 0;
    for f in m.files {
        let target = dir.join(&f.name);
        if hash_file(&target).is_ok_and(|h| h == f.sha256) {
            completed += f.size;
            PROGRESS.store((completed * 100 / total) as u32, Ordering::Relaxed);
            continue;
        }
        let temporary = target.with_extension("part");
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let mut response = client
                .get(format!(
                    "https://huggingface.co/{}/resolve/{}/{}",
                    m.repo, m.revision, f.name
                ))
                .send()?
                .error_for_status()?;
            let mut out = File::create(&temporary)?;
            let mut hash = Sha256::new();
            let mut received = 0u64;
            let mut buf = [0u8; 65536];
            loop {
                let n = response.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                received += n as u64;
                if received > f.size {
                    return Err("Unexpected download size".into());
                }
                hash.update(&buf[..n]);
                out.write_all(&buf[..n])?;
                PROGRESS.store(
                    ((completed + received) * 100 / total) as u32,
                    Ordering::Relaxed,
                );
            }
            if received != f.size || format!("{:x}", hash.finalize()) != f.sha256 {
                return Err("Model checksum mismatch".into());
            }
            out.sync_all()?;
            fs::rename(&temporary, &target)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        completed += f.size;
    }
    fs::write(dir.join(".complete"), m.revision)?;
    Ok(())
}

struct Worker {
    kind: BuiltInModel,
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
    events: mpsc::Receiver<Result<serde_json::Value, String>>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut active) = CHILD.lock() {
            *active = None;
        }
    }
}
impl Worker {
    fn start(p: &Paths) -> Result<Self, String> {
        let mut child = Command::new(&p.executable)
            .arg(&p.model)
            .arg(serde_json::to_value(p.kind).unwrap().as_str().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Could not start built-in cleanup: {e}"))?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, events) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let event = line
                    .map_err(|e| e.to_string())
                    .and_then(|l| serde_json::from_str(&l).map_err(|e| e.to_string()));
                if tx.send(event).is_err() {
                    break;
                }
            }
        });
        let child = Arc::new(Mutex::new(child));
        *CHILD.lock().map_err(|e| e.to_string())? = Some(child.clone());
        Ok(Self {
            kind: p.kind,
            child,
            stdin,
            events,
        })
    }
    fn event(
        &self,
        deadline: Instant,
        cancelled: &impl Fn() -> bool,
    ) -> Result<serde_json::Value, String> {
        loop {
            check_wait(deadline, cancelled)?;
            match self.events.recv_timeout(Duration::from_millis(50)) {
                Ok(event) => {
                    let event = event?;
                    if let Some(error) = event["error"].as_str() {
                        return Err(error.to_owned());
                    }
                    return Ok(event);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return Err("Built-in model stopped before completing cleanup".into()),
            }
        }
    }
}
fn check_wait(deadline: Instant, cancelled: &impl Fn() -> bool) -> Result<(), String> {
    if cancelled() {
        return Err(crate::ollama::CLEANUP_CANCELLED.into());
    }
    if Instant::now() >= deadline {
        return Err("Built-in cleanup timed out".into());
    }
    Ok(())
}
#[derive(Debug, Serialize, PartialEq)]
struct Controls {
    styling: &'static str,
    structure: &'static str,
    context: &'static str,
    skip: bool,
}
fn controls(settings: &crate::db::Settings, app: Option<&str>) -> Controls {
    let app = app.unwrap_or("").to_lowercase();
    let prompt = crate::inference::app_profile(settings, &app)
        .map(|p| p.prompt.to_lowercase())
        .unwrap_or_default();
    let has_app = |names: &[&str]| names.iter().any(|n| app.contains(n));
    let skip = has_app(&[
        "terminal",
        "iterm",
        "alacritty",
        "ghostty",
        "code",
        "cursor",
        "xcode",
        "intellij",
        "windsurf",
        "zed",
    ]) || [
        "verbatim",
        "terminal command",
        "do not fix grammar inside code",
    ]
    .iter()
    .any(|p| prompt.contains(p));
    // Translate only the supported presentation hints, not arbitrary instructions.
    let positive = prompt
        .split(['.', ';', '\n'])
        .filter(|clause| {
            !["do not", "don't", "never", "not be", "not use", "no "]
                .iter()
                .any(|n| clause.contains(n))
        })
        .collect::<Vec<_>>()
        .join(" ");
    let email = positive.contains("email") || has_app(&["mail", "outlook", "spark"]);
    let chat = has_app(&["slack", "discord", "messages", "whatsapp", "teams"]);
    let lists_denied = prompt.contains("no lists")
        || prompt.contains("not use lists")
        || prompt.contains("no bullet")
        || prompt.contains("not use markdown lists")
        || positive.contains("prose");
    Controls {
        styling: if positive.contains("lowercase") || positive.contains("lower case") {
            "casual"
        } else if positive.contains("casual") || positive.contains("informal") {
            "semi-casual"
        } else if positive.contains("formal") {
            "formal"
        } else if chat {
            "semi-casual"
        } else if email {
            "formal"
        } else {
            "semi-formal"
        },
        structure: if !lists_denied
            && (positive.contains("bullet")
                || positive.contains("list")
                || has_app(&["obsidian", "notes", "notion"]))
        {
            "lists"
        } else {
            "prose"
        },
        context: if email { "email" } else { "general" },
        skip,
    }
}
fn request(
    settings: &crate::db::Settings,
    text: &str,
    extra: Option<&str>,
    app: Option<&str>,
) -> serde_json::Value {
    let _ = extra; // Free-form context belongs to Ollama, outside S1-mini's training format.
    let c = controls(settings, app);
    serde_json::json!({"text":text,"styling":c.styling,"structure":c.structure,"context":c.context})
}
pub fn cleanup(
    settings: &crate::db::Settings,
    text: &str,
    extra: Option<&str>,
    app_name: Option<&str>,
    mut partial: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<String, String> {
    let model = settings.built_in_model;
    require_supported()?;
    if controls(settings, app_name).skip {
        return Ok(text.to_owned());
    }
    if settings.language != "en" {
        return Err("S1-mini requires English as the transcription language; keeping the original transcript".into());
    }
    if text.len() > 128000 {
        return Err("Transcript exceeds the 128 KB built-in cleanup input limit".into());
    }
    let p = paths(model)?;
    if !installed_at(model, &p.model) {
        return Err(format!(
            "Download {} from Intelligence before using cleanup",
            model.name()
        ));
    }
    let deadline = Instant::now() + Duration::from_secs(900);
    let mut slot = loop {
        check_wait(deadline, &cancelled)?;
        match WORKER.try_lock() {
            Ok(slot) => break slot,
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(_) => return Err("Built-in runtime lock failed".into()),
        }
    };
    let result = (|| {
        if slot.as_ref().is_some_and(|worker| worker.kind != model) {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(Worker::start(&p)?);
            if slot.as_ref().unwrap().event(deadline, &cancelled)?["ready"]
                .as_str()
                .is_none()
            {
                return Err("Invalid built-in runtime startup response".into());
            }
        }
        let worker = slot.as_mut().unwrap();
        let request = request(settings, text, extra, app_name);
        writeln!(worker.stdin, "{request}")
            .and_then(|_| worker.stdin.flush())
            .map_err(|e| e.to_string())?;
        loop {
            let event = worker.event(deadline, &cancelled)?;
            if let Some(text) = event["partial"].as_str() {
                partial(text);
            }
            if let Some(text) = event["done"].as_str() {
                return Ok(text.replace("[EMPTY]", "").trim().to_owned());
            }
        }
    })();
    // A cancelled/timed-out child must not leave stale output for the next request.
    if result.is_err() {
        *slot = None;
    }
    result
}
pub fn shutdown() {
    // Kill without waiting for the inference lock, which may be generating.
    let child = CHILD.lock().ok().and_then(|mut child| child.take());
    if let Some(child) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activation_requires_supported_runtime_download_and_english() {
        let mut settings = crate::db::Settings::default();
        settings.cleanup_provider = crate::inference::CleanupProvider::BuiltIn;
        settings.llm_cleanup_enabled = true;
        settings.language = "en".into();
        let mut status = Status {
            supported: false,
            installed: false,
            runtime_ready: false,
            downloading: false,
            progress: 0,
            download_bytes: 0,
            downloading_model: None,
        };
        assert!(activation_ready(&settings, &status)
            .unwrap_err()
            .contains("Apple Silicon"));
        status.supported = true;
        assert!(activation_ready(&settings, &status)
            .unwrap_err()
            .contains("runtime"));
        status.runtime_ready = true;
        assert!(activation_ready(&settings, &status)
            .unwrap_err()
            .contains("Set up"));
        status.installed = true;
        assert!(activation_ready(&settings, &status).is_ok());
        settings.language = "auto".into();
        assert!(activation_ready(&settings, &status)
            .unwrap_err()
            .contains("English"));
        settings.llm_cleanup_enabled = false;
        assert!(validate_settings(&settings).is_ok());
        settings.llm_cleanup_enabled = true;
        settings.cleanup_provider = crate::inference::CleanupProvider::Ollama;
        assert!(validate_settings(&settings).is_ok());
    }
    #[test]
    fn download_manifest_is_pinned_and_complete() {
        let m = manifest(BuiltInModel::S1Mini);
        assert_eq!(m.revision.len(), 40);
        assert!(m.files.iter().any(|f| f.name == "LICENSE"));
        assert!(m
            .files
            .iter()
            .any(|f| f.name == "model.safetensors" && f.size > 300_000_000));
        assert!(m
            .files
            .iter()
            .all(|f| f.sha256.len() == 64 && !f.name.contains('/')));
        assert!(!installed_at(
            BuiltInModel::S1Mini,
            Path::new("/nonexistent/patter-s1-test")
        ));
    }
    #[test]
    fn waiting_honors_cancellation_and_deadline() {
        assert_eq!(
            check_wait(Instant::now() + Duration::from_secs(10), &|| true).unwrap_err(),
            crate::ollama::CLEANUP_CANCELLED
        );
        assert!(check_wait(Instant::now(), &|| false).is_err());
    }

    #[test]
    fn app_profiles_choose_supported_controls_and_protect_code() {
        let mut settings = crate::db::Settings::default();
        settings.app_profiles = vec![crate::db::AppProfile {
            app: "Review Tool, My Mail".into(),
            prompt: "Use a formal email with bullet points.".into(),
        }];
        let email = controls(&settings, Some("Review Tool"));
        assert_eq!(
            (email.styling, email.structure, email.context),
            ("formal", "lists", "email")
        );
        let chat = controls(&settings, Some("Slack"));
        assert_eq!(chat.styling, "semi-casual");
        settings.app_profiles.push(crate::db::AppProfile {
            app: "Slack".into(),
            prompt: "Use a formal tone.".into(),
        });
        assert_eq!(controls(&settings, Some("Slack")).styling, "formal");
        assert_eq!(controls(&settings, Some("Obsidian")).structure, "lists");
        assert!(controls(&settings, Some("Visual Studio Code")).skip);
        assert!(controls(&settings, Some("Ghostty")).skip);
        settings.app_profiles[0].prompt = "Do not use lists. Do not be formal.".into();
        assert_eq!(controls(&settings, Some("Review Tool")).structure, "prose");
        assert_eq!(
            controls(&settings, Some("Review Tool")).styling,
            "semi-formal"
        );
    }
    #[test]
    fn s1_keeps_its_training_contract_and_ignores_free_form_prompts() {
        let settings = crate::db::Settings::default();
        let req = request(&settings, "raw words", Some("Write a story"), Some("Mail"));
        assert_eq!(req["context"], "email");
        assert!(req.get("messages").is_none());
        assert_eq!(req["text"], "raw words");
    }
    /// Downloads pinned weights and exercises the relocated bundled executable.
    #[test]
    #[ignore = "requires Apple Silicon, npm run build:s1, and a 347 MB download"]
    fn bundled_runtime_smoke() {
        let _serial = WORKER.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir()
            .join("patter-s1-smoke")
            .join(manifest(BuiltInModel::S1Mini).revision);
        install_into(BuiltInModel::S1Mini, &dir).unwrap();
        assert!(installed_at(BuiltInModel::S1Mini, &dir));
        let p = Paths {
            kind: BuiltInModel::S1Mini,
            model: dir,
            executable: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../native/s1-mini/dist/patter-s1"),
        };
        let mut worker = Worker::start(&p).unwrap();
        let deadline = Instant::now() + Duration::from_secs(90);
        assert!(worker.event(deadline, &|| false).unwrap()["ready"].is_string());
        for (input, expected) in [
            (
                "so um send the report by friday no wait thursday",
                "thursday",
            ),
            ("um", ""),
        ] {
            let request = serde_json::json!({"text":input,"styling":"semi-formal","structure":"prose","context":"general"});
            writeln!(worker.stdin, "{request}").unwrap();
            worker.stdin.flush().unwrap();
            loop {
                let event = worker.event(deadline, &|| false).unwrap();
                if let Some(done) = event["done"].as_str() {
                    println!("{input:?} -> {done:?}");
                    if expected.is_empty() {
                        assert_eq!(done, "");
                    } else {
                        assert!(done.to_lowercase().contains(expected));
                        assert!(!done.to_lowercase().contains("friday"));
                    }
                    break;
                }
            }
        }

        let long = include_str!("../../native/s1-mini/Tests/long-transcript.txt");
        let req = request(&crate::db::Settings::default(), long, None, None);
        writeln!(worker.stdin, "{req}").unwrap();
        worker.stdin.flush().unwrap();
        let mut chunks = 0;
        loop {
            let event = worker.event(deadline, &|| false).unwrap();
            if let Some(count) = event["chunks"].as_str() {
                chunks = count.parse::<usize>().unwrap();
            }
            if let Some(done) = event["done"].as_str() {
                assert!(chunks > 1);
                assert!(done.to_lowercase().contains("neptune"));
                println!("S1 long transcript cleaned in {chunks} chunks");
                break;
            }
        }
        shutdown();
        assert!(worker.event(deadline, &|| false).is_err());
    }
}
