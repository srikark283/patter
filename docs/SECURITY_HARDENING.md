# Security hardening status — 2026-11-01

This records the implementation following `SECURITY_REVIEW.md`. The review describes the original findings; this file describes their current status. Changes are local and have not been published.

## Implemented

| Finding/control | Implementation | Evidence |
|---|---|---|
| Unsafe macOS installer destination | Fixed `Patter.app` destination; signed updater archive; code-signature checks; staged replacement and previous-app recovery | Installer tests reject signature failure, missing app, and invalid code signature before installation side effects |
| Initial installer authenticity | Both scripts verify the existing pinned updater key with Minisign before installing | Real Tauri signature accepted by Minisign; changed fixture rejected; script keys checked against Tauri config |
| Ollama cloud leakage | Backend checks model catalog metadata before cleanup, command mode, embeddings, summaries, and warm-up; remote aliases/cloud tags and missing download metadata rejected; selection list excludes remote models | Remote-alias and malformed/missing metadata regression tests; all four HTTP inference entry points gated |
| Loopback egress | Ollama client disables system proxies and redirects; connection deadline | Local fixture responds with redirect; client returns the redirect without following it |
| Rust dependencies | Updated affected TLS/network crates and updater; Windows updater now uses ZIP 9; aligned Tauri JS API with Rust minor version | Cargo audit reports zero vulnerability records; locked dependency summary saved separately |
| Sensitive logging | Removed raw/cleaned transcript, command instruction, and snippet trigger logging | Source regression gate; timing and size-only diagnostics retained |
| Speech/diarization model integrity | All 18 files pinned to immutable Hugging Face revisions and SHA-256 hashes; existing models verified before native loading, including startup; mirror verifies hashes | Corrupted same-length fixture rejected; catalog/mirror manifest tests; upstream pinned file sizes checked |
| Speech/VAD download bounds | Expected-size cap before each write; connection/overall deadlines; verified staged installation; VAD pinned size/hash | Oversized chunk rejected without writing extra bytes; same integrity helper used by VAD |
| Clipboard dispatch failure | Restore previous text (or clear originally empty clipboard) on failure, only if clipboard is still owned by Patter | Source failure-path review; real clipboard behavior still requires platform interaction tests |
| Output destination | Capture original destination; verify immediately before main-thread keystroke dispatch; expired queued dispatch rejected | Identity/mismatch/unknown-target regression tests; Windows HWND and macOS owner PID/window ID used; interactive OS test remains |
| CSP | Separate production and Vite development policies; external scripts, frames and objects prohibited; IPC permitted; inline styles retained for existing UI | Production/custom-protocol application build; policy regression assertions |
| Native command isolation | Explicit generated command permissions; dashboard/settings access separated from HUD; HUD gets only sound theme and recording cancellation/stop commands | Command coverage and HUD-denial policy tests; native build validates manifests |
| Backup crash recovery | Durable staged originals and journal; startup rollback of interrupted restore; journal retained on recovery failure | Interrupted-commit fixture recovers old settings/history and removes newly introduced files; preflight failure preserves originals |
| Restore lifecycle | Reject restore during recording, invalidate older processing sessions, serialize meeting/history writers, prevent persistence until restart after successful restore | Storage regression suite; native lifecycle interaction remains to be exercised |
| Ordinary persistence | Settings/history/meetings/stats use synced temporary files and rename; new sensitive files have owner-only Unix permissions | Persistence regression tests; actual power-loss and Windows filesystem durability are not claimed tested |
| Multiple processes | OS-held app-data lock acquired before store initialization/recovery; private Unix app-data directory | Second lock attempt rejected; lock can be reacquired after first holder exits |
| Raw meeting audio retention | Startup clears an abandoned recording buffer after acquiring the data lock, failing startup on unexpected cleanup errors | Source startup-order review; normal stop/cancel cleanup retained |
| Release supply chain | Existing external Actions pinned to inspected commit SHAs; security CI added | Static pin assertions; CI will audit dependencies and run security regression checks |
| Unused artifacts | Removed unused legacy card CSS, unused HUD autostart capability, and tracked Python bytecode | Source searches; generated permissions and bytecode ignored |

## Verified results

- Rust source tests: **80 passed**, 3 ignored; download/hardware smoke checks excluded.
- Installer and policy regressions: **6 passed**, including real signature/tamper verification.
- All five UI/model JavaScript regression scripts: passed.
- Frontend production build and custom-protocol macOS application build: passed.
- Cargo advisory scan: **0 vulnerability records**, 5 upstream informational warnings retained.
- npm production dependency audit: **0 advisories**; full development tree: 6 low/moderate advisories.
- All 18 pinned upstream speech/diarization file sizes checked against their immutable revisions.

## Security checks

Run locally:

```sh
npm ci
npm run build
for test in scripts/tests/*.mjs; do node "$test"; done
python3 scripts/tests/security-regressions.py
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo audit --file src-tauri/Cargo.lock
npm audit --omit=dev --audit-level=low
npm audit --audit-level=high
npm exec tauri build -- --debug --no-bundle
```

Minisign is required for the real signing compatibility test and script installation; it was installed locally with Homebrew for this validation. The other installer tests replace downloader/extractor/installer commands with isolated fixtures and never modify `/Applications`. CI installs the verifier and executes those tests. Development source tests exclude hardware/download smoke tests unless explicitly requested.

## Remaining review gates

1. **Windows runtime verification:** execute the PowerShell installer, signed/tampered update fixtures, clipboard failure handling, destination changes, recovery journal, and interruption tests on Windows. Source and lockfile checks are not a substitute.
2. **Interactive macOS verification:** exercise the packaged UI's HUD command permissions, window changes while processing, clipboard failures, and onboarding/permission flows. A successful custom-protocol build validates compilation/configuration, not all runtime interactions.
3. **OS publisher identity:** macOS Developer ID signing/notarization and Windows Authenticode signing require the owner's signing credentials/accounts. The signed-artifact scripts are implemented; notarization/publisher trust has not been configured or claimed. README no longer advises bypassing OS warnings.
4. **GitHub protections:** configure protected version tags, release-signing environments/reviewers, and restricted access to signing secrets in repository settings. Immutable action refs are committed locally; remote protections were not changed. CI/release workflows have not been dispatched from this workspace.
5. **Advisory exceptions:** Cargo reports no vulnerability records but retains upstream maintenance warnings and the Linux GTK/GLib soundness warning (`RUSTSEC-2024-0429`). Linux is not in the shipped release matrix; do not add it without resolving/reassessing that dependency. The full npm tree retains six low/moderate Shadcn CLI/development-chain advisories; production dependency audit is zero. No forced breaking downgrade or blanket advisory suppression was added.
6. **Durability and egress assurance:** perform actual process-kill/power-loss tests on supported filesystems and packet-capture tests with synthetic transcripts. Directory syncing is performed on Unix; Windows crash guarantees require separate validation. Local fixture tests do not certify all installed Ollama behavior.

No encryption-at-rest guarantee is introduced. History, meetings and exported backups remain plaintext; Unix private file permissions, normal OS user-profile protection, disk encryption and the user's backup handling remain relevant. Text delivery through OS focus and clipboard APIs cannot be atomic with every user/application focus change; the new check reduces unintended delivery and fails closed when identity cannot be established.

## Deployment note

These changes upgrade the Tauri runtime and permissions, so ship them as a tested app update. Quit older Patter processes before running this build: an old version does not participate in the new directory lock. Existing cached speech models are verified before loading; a file that differs from the pinned release must be removed and downloaded again. Cold model loading now includes hashing, which adds disk-read time. No real transcript was sent to cloud services while implementing or testing these controls.
