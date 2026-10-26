# S1-mini + Ollama beta release checks

Scope: built-in S1-mini for English dictation cleanup on Apple Silicon/macOS 14+;
Ollama retains free-form instructions, personal memory, meetings, and commands.
S1-mini receives supported app formatting hints; dictionary corrections run before
cleanup. This is a beta, with no promise of full instruction following by S1-mini.

## Verified locally on 2026-10-26

- Production frontend and optimized macOS `.app` build succeed.
- Rust regression suite: 54 passed, 4 hardware/manual checks ignored by default.
- Swift chunking checks: sentence and word boundaries, Unicode, empty input, and
  exact character preservation pass.
- S1-mini hardware smoke: pinned weights, filler removal, spoken self-correction,
  two-chunk long transcript, and worker shutdown pass.
- The helper inside the production app loads the bundled Metal library and
  returns a successful correction. The local app is ad-hoc signed for validation;
  `codesign --verify --deep --strict` passes. This does not verify CI signing keys
  or an updater signature.
- The packaged app's transcript preview returns “So send the report by Thursday.”
  for the default self-correction sample. Disable/re-enable succeeds through the
  setup action. Missing weights on restart disable cleanup and show the 347 MB
  download action with the switch unavailable.
- A fresh 347 MB download completes through the single setup action and enables
  S1-mini. Switching to Ollama preserves the existing model selection. Original
  settings and weights are restored after validation.
- UI mechanical detector reports no findings for the changed settings views.

## Release gates still requiring a device or distribution run

- On a Mac with Patter's existing Accessibility, Input Monitoring, and Microphone
  grants, dictate into TextEdit, Mail, a chat app, and a code editor. Check output,
  cancellation, original-text fallback, and no partial paste. The locally ad-hoc
  signed app has no grants, so preview/runtime tests do not establish this.
- Validate on macOS 14 and a low-memory Apple Silicon Mac. This host runs newer
  macOS; a deployment target alone does not prove minimum-system compatibility.
- On Windows (and Intel/older macOS where distributed), verify Built-in is
  unavailable and existing Ollama setup, cleanup, and saved models still work.
- Interrupt a first download, retry, then relaunch offline. Confirm verified
  files are reused and settings change only after successful model loading.
- Run the release workflow with the real signing secrets. Verify the downloaded
  app's nested code signatures and updater signature; run the built-in preview
  from the distributed artifact.

## Release procedure

Use a prerelease tag such as `v0.4.16-beta.1` after updating the app version. Tags
containing a hyphen publish as GitHub prereleases. The stable updater endpoint
remains `releases/latest/download/latest.json`; beta builds stay opt-in.

The release workflow runs Rust tests on both platforms and the S1-mini hardware
smoke on macOS before publishing. A local `.app` build disables updater-artifact
creation only for that invocation; CI continues generating signed updater files.
No release has been tagged or published by this validation work.
