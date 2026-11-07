# Desktop code and security review — 2026-11-01

Current implementation status: see [Security hardening](SECURITY_HARDENING.md). Findings below record the pre-hardening review and are retained as historical evidence.
Scope: uncommitted Preferences work, recent Omni/model-selection changes, and connected model-installation, inference, settings, and backup paths. Assumed load: one user running the desktop application. This is a focused source review, not a whole-repository penetration test.

## Remaining findings

1. **P2 — Backup restore is not crash-atomic** (`src-tauri/src/db.rs`, `restore_backup`). Restore now stages files and rolls back ordinary replacement failures, but process termination between renaming settings, history, and meetings can leave different backup generations live. Recovery copies remain in the staging directory, but startup does not replay them automatically. A durable restore journal with startup recovery, or transactional storage, is needed to cover that failure. Background meeting writes are also not serialized by the history lock; restore should ultimately coordinate with the recording/meeting lifecycle.

2. **Security hardening — CSP is disabled** (`src-tauri/tauri.conf.json`, `app.security.csp`). A future script-injection bug would have no browser content policy to constrain script execution or outgoing connections. No concrete script-injection exploit was found in the reviewed paths. Add and validate a production CSP in a packaged Tauri build; development requires separate allowances for Vite. This review does not claim CSP alone protects native commands.

3. **Development dependencies — six remaining advisories.** The full npm audit reports four moderate and two low findings in the Shadcn CLI dependency chain (`shadcn`, `@shadcn/registry`, `ts-morph`, `@ts-morph/common`, `minimatch`, `deepmerge`). Shadcn is needed only to supply build-time CSS and is now a dev dependency. The production dependency audit (`npm audit --omit=dev`) reports zero. No forced major downgrade was applied.

## Fixed findings

- Preferences could issue overlapping full-settings writes and roll back a newer edit when an older write failed. Saves are now guarded, controls disabled while saving, and displayed settings committed only after success. Command-mode selection recovers on failure.
- Import ignored write failures and could announce success after only some files were saved. Restore now serializes and stages all files first, copies originals for rollback, rejects non-file destinations, reports errors, and retains recovery files if rollback fails.
- Import read an unrestricted file into memory. Reads are now capped at 100 MB before deserialization.
- Import reloaded only the frontend, leaving native settings/shortcuts unchanged. It now displays a restart action instead of pretending a page reload applies native configuration.
- Dependency updates removed the audit's high and critical findings. Shadcn was moved out of production dependencies.
- Removed the unused legacy inference-card and selection-radio CSS, including obsolete responsive and focus selectors. Removed an unused Preferences wrapper class.

## Security properties checked

- Built-in model process starts with direct arguments, not shell interpolation.
- Model downloads enforce expected byte sizes and SHA-256 hashes before installation completes.
- Nano's remote channel validates file names, uniqueness, revision hashes, release origins, file count, and total sizes before using metadata in filesystem paths.
- Mini and Omni use manifests embedded in the application rather than arbitrary remote install metadata.
- Cache removal avoids following symbolic links; model activation/removal guards and cancellation tests pass.
- Cleanup uses structured JSON and distinguishes trusted app instructions from transcript content. This does not guarantee an LLM cannot follow transcript instructions; generated text should continue to be treated as text, not executed.
- Permissions with unavailable status no longer appear as granted.

## Validation and limits

- Frontend TypeScript and production build: passed.
- Rust suite: 74 passed, 3 ignored, 4 filtered out (model downloads/hardware smoke checks excluded).
- Backup staging regression test rerun after final backend changes: passed.
- UI/model scripts: preferences-save, builtin-model-settings, intelligence-activation, intelligence-removal, model-activation: passed.
- Production npm audit: zero reported vulnerabilities. Full audit: six development-only findings described above.
- `git diff --check`: passed.
- Rust dependency advisory scan was not run: `cargo-audit` is not installed. Native permission prompts, restart, packaged CSP behavior, power-loss recovery, and Windows behavior were not exercised.
- The production build still warns about a generated CSS selector and large bundle chunks; neither is claimed to be a security finding.

Verdict: the reviewed fixes pass their checks; address restore crash/lifecycle coordination before describing backup restore as transactional, and validate CSP in a packaged security-hardening pass.
