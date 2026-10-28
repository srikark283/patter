//! A mutable metadata channel points to immutable, checksummed Flash releases.
use super::*;

pub const CHANNEL_URL: &str =
    "https://raw.githubusercontent.com/srikark283/patter/model-channel/stable.json";
const RELEASE_BASE: &str = "https://github.com/srikark283/patter/releases/download/";
const RUNTIME: &str = "flash-gemma3-v1";

#[derive(Clone, Deserialize, Serialize)]
pub struct Channel {
    schema_version: u32,
    runtime: String,
    pub version: String,
    source_weights_sha256: String,
    pub(super) desktop: Manifest,
    android: serde_json::Value,
}
fn hex(value: &str, lengths: &[usize]) -> bool {
    lengths.contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
impl Channel {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.runtime != RUNTIME {
            return Err("This model release requires a newer Patter app".into());
        }
        if !name(&self.version)
            || !self.version.starts_with("patter-flash-")
            || !hex(&self.source_weights_sha256, &[64])
            || !hex(&self.desktop.revision, &[40, 64])
        {
            return Err("Invalid Flash release identity".into());
        }
        let base = format!("{RELEASE_BASE}{}", self.version);
        if self.desktop.base_url.as_deref() != Some(base.as_str()) || !self.desktop.repo.is_empty()
        {
            return Err("Flash assets must come from the pinned Patter GitHub release".into());
        }
        let mut names = std::collections::HashSet::new();
        if !(3..=32).contains(&self.desktop.files.len()) {
            return Err("Invalid Flash file count".into());
        }
        let mut total = 0u64;
        for file in &self.desktop.files {
            if !name(&file.name)
                || !names.insert(file.name.as_str())
                || !hex(&file.sha256, &[64])
                || file.size == 0
                || file.size > 1_500_000_000
            {
                return Err("Invalid Flash asset".into());
            }
            total += file.size;
        }
        if total > 2_000_000_000
            || ![
                "config.json",
                "tokenizer.json",
                "model.safetensors",
                "GEMMA-TERMS.txt",
                "NOTICE.txt",
            ]
            .iter()
            .all(|n| names.contains(n))
        {
            return Err("Incomplete or oversized Flash release".into());
        }
        let android_name = self.android["filename"]
            .as_str()
            .ok_or("Missing Android asset")?;
        let android_size = self.android["expectedSize"]
            .as_u64()
            .ok_or("Invalid Android size")?;
        if !name(android_name)
            || !android_name.ends_with(".gguf")
            || android_size == 0
            || android_size > 1_500_000_000
            || !hex(self.android["sha256"].as_str().unwrap_or(""), &[64])
            || self.android["revision"].as_str() != Some(&self.desktop.revision)
            || self.android["url"].as_str() != Some(format!("{base}/{android_name}").as_str())
        {
            return Err("Invalid Android Flash release".into());
        }
        Ok(())
    }
}
fn baseline() -> Channel {
    serde_json::from_str(include_str!(
        "../../../native/s1-mini/flash-channel-v1.json"
    ))
    .expect("bundled Flash channel")
}
fn pointer(name: &str) -> Option<PathBuf> {
    Some(PATHS.get()?.model.join("patter-flash").join(name))
}
fn read_pointer(name: &str) -> Option<Channel> {
    let channel: Channel = serde_json::from_slice(&fs::read(pointer(name)?).ok()?).ok()?;
    channel.validate().ok()?;
    Some(channel)
}
pub(super) fn active_channel() -> Option<Channel> {
    read_pointer("active.json")
}
pub(super) fn current_channel() -> Channel {
    active_channel().unwrap_or_else(baseline)
}
pub(super) fn previous_version() -> Option<String> {
    let channel = read_pointer("previous.json")?;
    let p = paths_for_manifest(BuiltInModel::PatterFlash, &channel.desktop).ok()?;
    installed_manifest(&channel.desktop, &p.model).then_some(channel.version)
}
fn remote() -> Result<Channel, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let response = client
        .get(format!("{CHANNEL_URL}?t={nonce}"))
        .header("Cache-Control", "no-cache")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not check Flash updates: {e}"))?;
    let mut bytes = Vec::new();
    response
        .take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 65_536 {
        return Err("Flash channel is too large".into());
    }
    let channel: Channel =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid Flash channel: {e}"))?;
    channel.validate()?;
    Ok(channel)
}
#[derive(Serialize)]
pub struct Check {
    current_version: String,
    latest_version: String,
    update_available: bool,
    download_bytes: u64,
}
pub fn check() -> Result<Check, String> {
    let latest = remote()?;
    let current = current_channel();
    Ok(Check {
        update_available: latest.desktop.revision != current.desktop.revision,
        current_version: current.version,
        latest_version: latest.version,
        download_bytes: latest.desktop.files.iter().map(|f| f.size).sum(),
    })
}
fn write_pointer(name: &str, channel: &Channel) -> Result<(), String> {
    let path = pointer(name).ok_or("Built-in runtime is not initialized")?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec(channel).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
fn probe(p: &Paths) -> Result<(), String> {
    let mut worker = Worker::start(p)?;
    let deadline = Instant::now() + Duration::from_secs(90);
    if !worker.event(deadline, &|| false)?["ready"].is_string() {
        return Err("Flash did not become ready".into());
    }
    writeln!(worker.stdin, "{}", serde_json::json!({"text":"Please send the report tomorrow.", "instruction":"Clean this English dictation with minimal edits."}))
        .and_then(|_| worker.stdin.flush()).map_err(|e| e.to_string())?;
    loop {
        let event = worker.event(deadline, &|| false)?;
        if let Some(done) = event["done"].as_str() {
            return if done.trim().is_empty() {
                Err("Flash returned an empty readiness probe".into())
            } else {
                Ok(())
            };
        }
    }
}
fn activate(channel: Channel) -> Result<(), String> {
    channel.validate()?;
    let p = paths_for_manifest(BuiltInModel::PatterFlash, &channel.desktop)?;
    if !installed_manifest(&channel.desktop, &p.model) {
        return Err("Flash release has not been downloaded completely".into());
    }
    // Keep inference and activation serialized; failed probes leave the pointer intact.
    let mut slot = WORKER.lock().map_err(|e| e.to_string())?;
    let result = probe(&p);
    *CHILD.lock().map_err(|e| e.to_string())? = slot.as_ref().map(|worker| worker.child.clone());
    result?;
    let current = current_channel();
    if channel.desktop.revision != current.desktop.revision {
        write_pointer("previous.json", &current)?;
    }
    write_pointer("active.json", &channel)?;
    if slot
        .as_ref()
        .is_some_and(|worker| worker.kind == BuiltInModel::PatterFlash)
    {
        *slot = None;
    }
    Ok(())
}
pub fn install(expected_version: Option<String>) -> Result<(), String> {
    require_supported()?;
    let latest = remote()?;
    if expected_version
        .as_ref()
        .is_some_and(|version| version != &latest.version)
    {
        return Err("The channel changed; check for updates again".into());
    }
    if DOWNLOADING
        .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Err("A model installation is already running".into());
    }
    let _guard = DownloadGuard;
    PROGRESS.store(0, Ordering::Relaxed);
    let p = paths_for_manifest(BuiltInModel::PatterFlash, &latest.desktop)?;
    if !p.executable.is_file() || !p.executable.with_file_name("mlx.metallib").is_file() {
        return Err("The built-in runtime is missing; reinstall Patter".into());
    }
    download_manifest(BuiltInModel::PatterFlash, &p.model, None, &latest.desktop)
        .map_err(|e| e.to_string())?;
    activate(latest)
}
pub fn rollback() -> Result<(), String> {
    let previous = read_pointer("previous.json")
        .ok_or("No previous Flash model is available on this device")?;
    if DOWNLOADING
        .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Err("A model installation is already running".into());
    }
    let _guard = DownloadGuard;
    activate(previous)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn channel_validation_rejects_incompatible_and_untrusted_assets() {
        let original = baseline();
        original.validate().unwrap();
        let mut c = original.clone();
        c.runtime = "new-architecture".into();
        assert!(c.validate().is_err());
        let mut c = original.clone();
        c.desktop.files[0].name = "../active.json".into();
        assert!(c.validate().is_err());
        let mut c = original.clone();
        c.desktop.base_url = Some("https://example.com/weights".into());
        assert!(c.validate().is_err());
        let mut c = original.clone();
        c.desktop.files[0].sha256 = "bad".into();
        assert!(c.validate().is_err());
        let mut c = original.clone();
        c.desktop.files.push(c.desktop.files[0].clone());
        assert!(c.validate().is_err());
        let mut c = original;
        c.android["url"] = "https://example.com/weights.gguf".into();
        assert!(c.validate().is_err());
    }
    #[test]
    #[ignore = "requires Apple Silicon, network and npm run build:s1"]
    fn channel_install_probe_failure_and_rollback_smoke() {
        require_supported().unwrap();
        let root = std::env::temp_dir().join(format!("patter-flash-update-{}", std::process::id()));
        PATHS
            .set(Paths {
                kind: BuiltInModel::PatterFlash,
                model: root.clone(),
                executable: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../native/s1-mini/dist/patter-intelligence"),
            })
            .ok()
            .expect("isolated smoke process");
        install(None).unwrap();
        let original = current_channel();
        assert!(pointer("active.json").unwrap().is_file());
        let settings = crate::db::Settings {
            built_in_model: BuiltInModel::PatterFlash,
            language: "en".into(),
            ..Default::default()
        };
        assert!(super::super::cleanup(
            &settings,
            "send the report tomorrow",
            None,
            None,
            |_| {},
            || false
        )
        .unwrap()
        .to_lowercase()
        .contains("tomorrow"));
        let mut candidate = original.clone();
        candidate.version = "patter-flash-smoke-candidate".into();
        candidate.desktop.revision = "a".repeat(40);
        candidate.desktop.base_url = Some(format!("{RELEASE_BASE}{}", candidate.version));
        candidate.android["revision"] = candidate.desktop.revision.clone().into();
        candidate.android["url"] = format!(
            "{RELEASE_BASE}{}/{}",
            candidate.version,
            candidate.android["filename"].as_str().unwrap()
        )
        .into();
        let target = paths_for_manifest(BuiltInModel::PatterFlash, &candidate.desktop)
            .unwrap()
            .model;
        fs::create_dir_all(&target).unwrap();
        for file in &candidate.desktop.files {
            File::create(target.join(&file.name))
                .unwrap()
                .set_len(file.size)
                .unwrap();
        }
        fs::write(target.join(".complete"), &candidate.desktop.revision).unwrap();
        assert!(activate(candidate.clone()).is_err());
        assert_eq!(current_channel().version, original.version);
        let source = paths_for_manifest(BuiltInModel::PatterFlash, &original.desktop)
            .unwrap()
            .model;
        for file in &original.desktop.files {
            fs::copy(source.join(&file.name), target.join(&file.name)).unwrap();
        }
        activate(candidate.clone()).unwrap();
        assert_eq!(current_channel().version, candidate.version);
        assert_eq!(previous_version(), Some(original.version.clone()));
        rollback().unwrap();
        assert_eq!(current_channel().version, original.version);
        shutdown();
        fs::remove_dir_all(root).unwrap();
    }
}
