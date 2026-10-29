# patter-1-nano

Release ID: patter-1-nano-80f6f5c1b8be

A Patter fine-tune of Gemma 3 270M for short English dictation cleanup.
Google does not endorse this modified model. Both artifacts use the same fused
checkpoint; quantization differences can change output.

- Desktop: MLX affine 4-bit, group size 64; Apple Silicon and macOS 14+.
- Android: GGUF Q4_K_M, including higher-bit fallback tensors where required.
  Use a Patter Android build with patter-1-nano channel-update support.

The apps discover this release through their shared model channel. Downloads
are checked by size/SHA-256 and probed before activation; the previous model
remains available for rollback. Both runtime smoke checks passed. These checks
are not a broad quality evaluation or a physical Android performance benchmark.

By downloading, using or redistributing these weights, you agree to the Gemma
Terms of Use, including Section 3.2 and GEMMA-PROHIBITED-USE-POLICY.txt.
Read GEMMA-TERMS.txt and NOTICE.txt; Android conversions additionally carry
patter-1-nano-gguf-NOTICE.txt. Pass the terms, restrictions and modification
notices on with redistribution. The application's code license does not replace
the model terms. https://ai.google.dev/gemma/terms
