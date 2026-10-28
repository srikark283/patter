//! A mutable metadata channel points to immutable, checksummed patter-1-nano releases.
use super::*;

pub const CHANNEL_URL: &str =
    "https://raw.githubusercontent.com/srikark283/patter/model-channel/models/patter-1-nano/stable.json";
const RELEASE_BASE: &str = "https://github.com/srikark283/patter/releases/download/";
const RUNTIME: &str = "gemma3-270m-cleanup-v1";

#[derive(Clone, Deserialize, Serialize)]
pub struct Channel {
    schema_version: u32,
    runtime: String,
    #[serde(default)]
    model_id: String,
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
        self.validate_contract(false)
    }
    // Historical release tags are accepted only for saved/bundled state, never remote updates.
    fn validate_cached(&self) -> Result<(), String> {
        self.validate_contract(self.schema_version == 1)
    }
    fn validate_contract(&self, legacy: bool) -> Result<(), String> {
        let runtime = if legacy { "flash-gemma3-v1" } else { RUNTIME };
        let prefix = if legacy {
            "patter-flash-"
        } else {
            "patter-1-nano-"
        };
        if self.schema_version != if legacy { 1 } else { 2 }
            || self.runtime != runtime
            || self.model_id != "patter-1-nano"
            || self.desktop.variant_id.as_deref() != Some("mlx-4bit")
            || self.android["variant_id"].as_str() != Some("gguf-q4_k_m")
        {
            return Err("This model release requires a newer Patter app".into());
        }
        if !name(&self.version)
            || !self.version.starts_with(prefix)
            || !hex(&self.source_weights_sha256, &[64])
            || !hex(&self.desktop.revision, &[40, 64])
        {
            return Err("Invalid patter-1-nano release identity".into());
        }
        let base = format!("{RELEASE_BASE}{}", self.version);
        if self.desktop.base_url.as_deref() != Some(base.as_str()) || !self.desktop.repo.is_empty()
        {
            return Err(
                "patter-1-nano assets must come from the pinned Patter GitHub release".into(),
            );
        }
        let mut names = std::collections::HashSet::new();
        if !(3..=32).contains(&self.desktop.files.len()) {
            return Err("Invalid patter-1-nano file count".into());
        }
        let mut total = 0u64;
        for file in &self.desktop.files {
            if !name(&file.name)
                || !names.insert(file.name.as_str())
                || !hex(&file.sha256, &[64])
                || file.size == 0
                || file.size > 1_500_000_000
            {
                return Err("Invalid patter-1-nano asset".into());
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
            return Err("Incomplete or oversized patter-1-nano release".into());
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
            return Err("Invalid Android patter-1-nano release".into());
        }
        Ok(())
    }
}
fn decode_cached(bytes: &[u8]) -> Option<Channel> {
    let mut channel: Channel = serde_json::from_slice(bytes).ok()?;
    if channel.schema_version == 1 {
        if !channel.model_id.is_empty() && channel.model_id != "patter-1-nano" {
            return None;
        }
        channel.model_id = "patter-1-nano".into();
        channel.desktop.variant_id = Some("mlx-4bit".into());
        channel.android["variant_id"] = "gguf-q4_k_m".into();
    }
    channel.validate_cached().ok()?;
    Some(channel)
}
fn baseline() -> Channel {
    decode_cached(include_bytes!("../../../native/s1-mini/nano-channel.json"))
        .expect("bundled Nano channel")
}
fn pointer(name: &str) -> Option<PathBuf> {
    Some(PATHS.get()?.model.join("patter-1-nano/mlx-4bit").join(name))
}
fn read_pointer(name: &str) -> Option<Channel> {
    decode_cached(&fs::read(pointer(name)?).ok()?)
}
pub(super) fn active_channel() -> Option<Channel> {
    read_pointer("active.json")
}
pub(super) fn current_channel() -> Channel {
    active_channel().unwrap_or_else(baseline)
}
pub(super) fn previous_version() -> Option<String> {
    let channel = read_pointer("previous.json")?;
    let p = paths_for_manifest(BuiltInModel::Patter1Nano, &channel.desktop).ok()?;
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
        .map_err(|e| format!("Could not check patter-1-nano updates: {e}"))?;
    let mut bytes = Vec::new();
    response
        .take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 65_536 {
        return Err("patter-1-nano channel is too large".into());
    }
    let channel: Channel = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid patter-1-nano channel: {e}"))?;
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
        return Err("patter-1-nano did not become ready".into());
    }
    writeln!(worker.stdin, "{}", serde_json::json!({"text":"Please send the report tomorrow.", "instruction":"Clean this English dictation with minimal edits."}))
        .and_then(|_| worker.stdin.flush()).map_err(|e| e.to_string())?;
    loop {
        let event = worker.event(deadline, &|| false)?;
        if let Some(done) = event["done"].as_str() {
            return if done.trim().is_empty() {
                Err("patter-1-nano returned an empty readiness probe".into())
            } else {
                Ok(())
            };
        }
    }
}
fn activate(channel: Channel) -> Result<(), String> {
    channel.validate_cached()?;
    let p = paths_for_manifest(BuiltInModel::Patter1Nano, &channel.desktop)?;
    if !installed_manifest(&channel.desktop, &p.model) {
        return Err("patter-1-nano release has not been downloaded completely".into());
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
        .is_some_and(|worker| worker.kind == BuiltInModel::Patter1Nano)
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
    let p = paths_for_manifest(BuiltInModel::Patter1Nano, &latest.desktop)?;
    if !p.executable.is_file() || !p.executable.with_file_name("mlx.metallib").is_file() {
        return Err("The built-in runtime is missing; reinstall Patter".into());
    }
    download_manifest(BuiltInModel::Patter1Nano, &p.model, None, &latest.desktop)
        .map_err(|e| e.to_string())?;
    activate(latest)
}
pub fn rollback() -> Result<(), String> {
    let previous = read_pointer("previous.json")
        .ok_or("No previous patter-1-nano model is available on this device")?;
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
        let legacy = decode_cached(include_bytes!("../../../native/s1-mini/flash-channel-v1.json")).unwrap();
        assert!(legacy.validate().is_err());
        let mut original = baseline();
        original.validate_cached().unwrap();
        original.schema_version = 2;
        original.runtime = RUNTIME.into();
        original.version = "patter-1-nano-test".into();
        original.desktop.base_url = Some(format!("{RELEASE_BASE}{}", original.version));
        original.android["url"] = format!(
            "{RELEASE_BASE}{}/{}",
            original.version,
            original.android["filename"].as_str().unwrap()
        )
        .into();
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
        let mut c = original.clone();
        c.model_id = "patter-1-mini".into();
        assert!(c.validate().is_err());
        let mut c = original.clone();
        c.desktop.variant_id = Some("gguf-q4_k_m".into());
        assert!(c.validate().is_err());
        let mut c = original.clone();
        c.android["variant_id"] = "mlx-4bit".into();
        assert!(c.validate().is_err());
        let mut c = original;
        c.android["url"] = "https://example.com/weights.gguf".into();
        assert!(c.validate().is_err());
    }
    #[test]
    #[ignore = "requires Apple Silicon, network and npm run build:s1"]
    fn channel_install_probe_failure_and_rollback_smoke() {
        require_supported().unwrap();
        let root =
            std::env::temp_dir().join(format!("patter-1-nano-update-{}", std::process::id()));
        PATHS
            .set(Paths {
                kind: BuiltInModel::Patter1Nano,
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
            built_in_model: BuiltInModel::Patter1Nano,
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
        candidate.version = "patter-1-nano-smoke-candidate".into();
        candidate.schema_version = 2;
        candidate.runtime = RUNTIME.into();
        candidate.desktop.revision = "a".repeat(40);
        candidate.desktop.base_url = Some(format!("{RELEASE_BASE}{}", candidate.version));
        candidate.android["revision"] = candidate.desktop.revision.clone().into();
        candidate.android["url"] = format!(
            "{RELEASE_BASE}{}/{}",
            candidate.version,
            candidate.android["filename"].as_str().unwrap()
        )
        .into();
        let target = paths_for_manifest(BuiltInModel::Patter1Nano, &candidate.desktop)
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
        let source = paths_for_manifest(BuiltInModel::Patter1Nano, &original.desktop)
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
