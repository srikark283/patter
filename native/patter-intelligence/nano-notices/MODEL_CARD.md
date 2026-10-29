# patter-1-nano — MLX 4-bit (beta)

A modified, fine-tuned derivative of `google/gemma-3-270m-it` for English
speech-to-text cleanup. Export: MLX affine 4-bit, group size 64. Model weights
and configuration were modified by Patter; this is not an official Google model.

Requires Patter with patter-1-nano support, Apple Silicon, and macOS 14 or newer.
In Intelligence, select Built-in → patter-1-nano → Download & enable.
For manual installation, download and extract `patter-1-nano-mlx-4bit.tar.gz`.

Best suited to short English dictation. The long transcript check can exhaust
the generation limit; Patter retains the original transcript on that failure.
Check names, numbers, negation, and identifiers in important output. No broad
quality or multilingual claims are made for this beta export.

## Terms

By downloading, using, or redistributing these weights, you agree to the Gemma
Terms of Use in GEMMA-TERMS.txt, including the Section 3.2 use restrictions and
the accompanying GEMMA-PROHIBITED-USE-POLICY.txt. Any redistribution must pass
these requirements and notices on to recipients. See NOTICE.txt for attribution
and modification details. The model weights are governed by these terms,
separately from Patter's application source code.

Sources: https://ai.google.dev/gemma/terms and
https://ai.google.dev/gemma/prohibited_use_policy.
