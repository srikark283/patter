# Application security review — 2026-11-01

Current implementation status: see [Security hardening](SECURITY_HARDENING.md). Findings below record the pre-hardening review and are retained as historical evidence.
Verdict: address findings 1–4 before treating Patter as ready for sensitive dictation. The previous focused review did not establish the security of the full application.

This pass examined application trust boundaries across the Rust/Tauri backend, React frontend, Swift MLX helper, model catalog/downloaders, recording and paste paths, persistence/backup, installers, and CI/release scripts. It includes dependency scans and targeted dependency-source checks. It is a repository-wide security assessment, not proof that every source line or bundled binary is vulnerability-free.

Threat model: private dictation/meetings on a single-user desktop; potentially untrusted transcripts and backups; network/model suppliers; a compromised frontend; accidental focus changes and failed/interrupted storage operations. A fully compromised user account can already read most local application data and is not treated as a new remote vulnerability.

## Confirmed findings

### 1. P1 — macOS installer can target the whole Applications directory

Evidence: `install.sh:28–30`.

If the mounted DMG contains no matching `.app`, `find` succeeds with empty output. `basename ""` succeeds and returns an empty string, so the following deletion resolves to `rm -rf /Applications/`. The installer's permissions limit what it can delete, but user-writable applications are at risk; elevated execution would be worse.

Validation: evaluated the empty basename/path calculation without running the installer or any deletion; the computed target was `/Applications/`.

Fix: require exactly the expected `Patter.app`, validate it is a directory inside the mounted volume, use a fixed `/Applications/Patter.app` destination, and stage the replacement before removing the previous installation. Always detach the mounted image on failure.

### 2. P1 — Ollama cloud models can violate the app's local-only privacy promise

Evidence: `src-tauri/src/ollama.rs:201–209,258–267`, chat/meeting request builders, and privacy/connection copy in Preferences and Intelligence.

Model-list responses are reduced to names; remote-model metadata is discarded. The backend accepts configured model names without a local-execution check. A signed-in Ollama instance can serve a cloud-backed model through its local interface. Selecting such a model can send dictation, meeting transcripts, and included memory/context off-device while the app describes processing as local.

This is a conditional data route, not evidence that this user's prompts were uploaded. Ollama's [API schema](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml) exposes `remote_model` and `remote_host`; its [cloud documentation](https://docs.ollama.com/cloud) confirms cloud prompt processing.

Fix: enforce local-only selection and execution in the backend using model metadata, including aliases, for cleanup, command mode, embeddings, and meeting summaries. Revalidate saved settings; filtering names ending in `:cloud` alone is insufficient. Alternatively expose cloud execution as an explicit consented mode and correct all privacy claims.

### 3. P1 — vulnerable Rust dependencies reach the updater/network stack

Evidence: `src-tauri/Cargo.lock`; detailed machine-readable results in `security/dependency-audit-2026-11-01.json`.

`cargo audit` reports 11 vulnerability records: h2 0.4.15; four Rustls records against 0.23.41; rustls-webpki 0.103.13; webpki-root-certs/webpki-roots 1.0.8; and three zip records against 4.6.1. There are also soundness warnings for Tokio 1.53.1, event-listener 5.4.1, and Linux's glib 0.18.5, plus maintenance warnings.

Reachability checked: Rustls 0.23.41 reaches the shipped updater through reqwest 0.13.4. h2 and Tokio reach networking. zip reaches the Windows updater; its dependency source calls `ZipArchive::extract` when ZIP extraction is enabled. Updater signatures are verified, so the archive advisories do not establish that an arbitrary unsigned network ZIP can exploit Patter. Several root-certificate dependencies are not in the normal runtime graph on this Mac. These are advisory matches with differing preconditions, not 11 demonstrated exploits.

Fix: update compatible lockfile dependencies (notably Rustls >=0.23.46, h2 >=0.4.16, rustls-webpki >=0.103.16, Tokio >=1.53.3) and upgrade the owning updater dependency to address ZIP. Re-run audit and packaged macOS/Windows update tests. Consult each advisory's affected versions rather than blindly forcing major versions. Primary references include [Rustls](https://rustsec.org/advisories/RUSTSEC-2026-0285.html) and [Tokio](https://rustsec.org/advisories/RUSTSEC-2026-0386.html).

### 4. P2 — private dictation and voice instructions are written to stdout

Evidence: `src-tauri/src/recording.rs:471,659,950`.

Raw transcripts, cleaned transcripts, and command instructions are logged unconditionally. Launchers, debugging sessions, or captured support logs can retain confidential content outside the app's history controls. Deleting a transcript does not remove that copy. No telemetry upload was identified in this path.

Fix: omit content; retain counts/timing and content-free error categories. Any content logging should require a deliberate, temporary diagnostic opt-in.

### 5. P2 — speech/VAD model integrity checks are weaker than built-in cleanup models

Evidence: `src-tauri/src/models/registry.rs` (`CATALOG`, `state`, `download_variant`), `src-tauri/src/vad.rs:23–31`, `.github/scripts/sync_model_mirror.py:84–105`.

Speech models use mutable upstream `resolve/main` URLs and accept files based on size. The mirror also verifies only size. A substituted file with the same byte count is considered complete and handed to native model parsers. VAD accepts any existing file and downloads without a pinned digest. This requires supplier/cache tampering or another delivery-path failure; HTTPS is present and no parser-code-execution exploit was demonstrated.

Fix: pin immutable revisions and published SHA-256 values, verify before installation, and propagate the same manifest to the mirror. Give VAD the same staged/checksummed installation contract as built-in cleanup models.

### 6. P2 — speech/VAD downloads can consume unbounded disk or memory

Evidence: `registry.rs:308–344`, `vad.rs:27–29`.

Speech downloads enforce expected size only after the entire stream is written; there is no explicit request deadline. An oversized/endless successful response can fill disk. VAD collects the full response into memory without a byte cap. The bounded built-in cleanup downloader already provides a better pattern.

Fix: reject a chunk before it would exceed the catalog size; set connection/overall deadlines, cap VAD bytes while reading, remove failed staging files, and test an oversized response using a local fixture server.

### 7. P2 — output dispatch failure leaves confidential text on the clipboard

Evidence: `src-tauri/src/paste.rs:196–207`.

The transcript replaces clipboard contents before OS dispatch. If Enigo initialization/dispatch fails or times out, `?` exits before restoration is scheduled. The previous text clipboard is available but never restored on that path. The existing non-text clipboard limitation is documented and is distinct from this failure.

Fix: restore the previous text clipboard on failure if the clipboard still contains Patter's value; preserve another application's newer clipboard contents. Test dispatch failure with a fake clipboard/dispatcher.

## Hardening gaps and privacy considerations

- **CSP and command isolation:** `tauri.conf.json` disables CSP; `build.rs` does not constrain custom-command exposure by window. Tauri permits registered application commands from app webviews by default, separately from plugin permissions ([official capabilities documentation](https://v2.tauri.app/security/capabilities/)). A future script-injection bug would therefore have broad native access. No concrete HTML/script injection was found in the reviewed rendering paths, and no remote capability origin is configured. Add production CSP, explicit command permissions, and per-window least privilege; validate the packaged webview.
- **Initial installer authenticity:** both shell installers download live GitHub release assets without verifying an independently pinned artifact signature. The macOS path does not obtain normal browser quarantine handling and uses self-signing rather than Developer ID notarization. This relies on GitHub/release-account integrity. Verify signed artifacts before running/copying them and publish a supported notarized installation path.
- **Output focus:** recording remembers an app name for profiles, but dispatch targets whichever app is focused when processing finishes. Command mode can likewise replace a different selection if focus changes. Consider capturing process/window identity and requiring recovery/confirmation when the destination changes; app display names alone are not stable identities. This is an insertion-safety/privacy risk, not demonstrated automatic message sending.
- **Local HTTP client:** the Ollama client uses reqwest defaults, including redirects/system proxy behavior. Disable proxies and redirects for the loopback-only client so proxy configuration or local-service redirects cannot widen the transcript route. No remote proxy interception was performed.
- **Storage/retention:** transcript/meeting/settings backups are plaintext. Meeting audio uses `meeting_buffer.f32`, deleted on normal stop/cancel but without startup crash cleanup. OS account/disk protections matter; this review did not establish file ACLs on every target or claim that plaintext storage alone is a vulnerability. Define retention and crash-recovery behavior, and document exported backup sensitivity.
- **Restore consistency:** the prior review's crash/lifecycle coordination finding remains. The staged restore is not a transaction across three live JSON files, and meeting writers are not serialized by the history lock.
- **Release supply chain:** external GitHub Actions use mutable version refs, and release jobs have write tokens plus signing secrets. Pin actions to audited commit SHAs, protect version tags and signing environments, and add advisory scans to CI. Repository branch/tag/environment protections were not inspected remotely; their absence is not asserted.

## Positive controls verified

- No arbitrary network-listening HTTP service was found in the native app; the MLX helper uses private stdin/stdout, with direct process arguments rather than a shell.
- Catalog IDs constrain model filesystem paths; Nano update metadata validates names, hashes, sizes, revisions, and expected release origin.
- Built-in cleanup downloads verify hashes and sizes before marking installation complete. Cancellation/deadline and deletion guards have regression tests.
- React renders transcript content as text; no `dangerouslySetInnerHTML`, `innerHTML`, or application `eval` use was found in frontend source searches.
- Automatic updater artifacts use a configured public signing key and Tauri's verified download/install path. This is stronger than the initial shell installers.
- CI pull-request jobs have read-only repository permissions. No `pull_request_target` execution of PR code with signing secrets was found in the checked workflows.
- A targeted tracked-file private-key/token pattern scan found no matches. This is not a complete secret-history scan.

## Validation and limits

Ran cargo-audit 0.22.2 against Cargo.lock, using RustSec database commit `2295466c4e9df26647fd67d8fa1c705ac2fc7f81` (updated 2026-10-30). Installed the scanner from crates.io into the user's tool cache; no application dependency versions were changed in this pass.

Re-ran npm audits: production dependencies 0 advisories; full tree 6 (4 moderate, 2 low) in development tooling. Previous fixes remain in the working tree. This pass added review artifacts and did not remediate the new findings.

Used source tracing, dependency reverse graphs (including Windows/all-target graphs), official upstream documentation, and a harmless installer path calculation. Did not run a destructive installer, send real transcripts to cloud services, modify permission grants, publish releases, or exploit a parser.

Not performed: Windows/Linux runtime testing; malicious model/parser fuzzing; native MLX/ONNX/Whisper binary audits; Swift/C/C++ advisory scans; packet-capture egress verification; signed malicious updater tests; installed-app/OS sandbox penetration testing; remote repository protection inspection; full Git-history secret scanning. These are the next assurance steps after the source-level findings are addressed.
