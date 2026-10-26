# Cleanup evaluation

This suite isolates intelligence/cleanup; it does not measure microphone, ASR,
VAD, memory retrieval, UI, or insertion. Requests are exported from production Rust
so prompts, examples, context ordering, and generation options cannot drift.
Python measures the local Ollama stream and retains the final server counters.

## Run

Quit Patter and stop other inference workloads first, including background warm-up.
Use installed models; the runner never downloads models automatically.

```sh
python3 -m unittest discover -s evals/cleanup -p 'test_*.py'
python3 evals/cleanup/run.py --models qwen2.5:7b --repeats 3
python3 evals/cleanup/run.py --models qwen2.5:7b qwen3.5:4b --repeats 5 --max-p95-ms 1000
python3 evals/cleanup/run.py --models qwen2.5:7b --phase cold --repeats 2
```

Warm runs prefill the production fixed prefix once per model, then shuffle cases
with a recorded seed. Cold runs explicitly unload the target model before each
request; unloading is excluded from request latency. These are model-load cold
runs, not OS disk-cache cold runs. A warm phase is intent, not proof of residency:
inspect `load_duration` and cached-token counters to verify what actually happened.

Cleanup requests use a 60s socket timeout; warm-up allows 180s. No retries hide failures.
Samples are written immediately under `evals/results/<timestamp>/samples.jsonl`.
Summary p50/p95 use nearest rank over completed requests; errors are counted
separately and always fail the run. Exit 1 means a quality or configured latency
gate failed. A tiny `--limit 2 --repeats 1` run is a smoke test, not a benchmark.

Artifacts include exact requests, selected fixtures, model digests in samples,
revision, tracked working-tree patch/hash, platform, and seed. Artifacts contain
transcripts/context; they stay local and are ignored by Git. Server counters retain
Ollama's units: durations are nanoseconds, counts are tokens; client times are ms.
First-text latency is measured before any UI throttling. No server counters are
invented when the Ollama version omits them.

## Quality

The seed fixtures cover fillers, negation, numbers, code, names, formatting,
corrections, app context, and instructions spoken as transcript content. They are
independent evaluation examples rather than copies of the production few-shot set.
The user-provided travel sentence is included as a regression example.

`expected` lists accepted outputs. Comparison trims outer whitespace and normalizes
CRLF only; punctuation and internal line breaks matter. This is a conservative
regression gate, not a complete semantic accuracy score. Review failed outputs and
add acceptable alternatives deliberately. Do not loosen checks just to favor a
model. Expand the dataset with consented real transcripts and a held-out set before
choosing a production model. Human review must check names, amounts, negation,
omissions, invented information, and whether spoken corrections were understood.

## Optional local MLflow + SQLite

MLflow is evaluation tooling only; it is not an app dependency. SQLite stores run
metadata and metrics, while local artifacts store requests and per-case traces.
No external tracking server, Postgres, or Docker is needed. Existing MLflow
experiments keep their original artifact location (the first local validation runs
use the Git-ignored `mlruns/` directory); new experiments use `evals/results/mlartifacts/`.

```sh
python3 -m venv evals/.venv
evals/.venv/bin/pip install -r evals/cleanup/requirements.txt
evals/.venv/bin/python evals/cleanup/run.py --models qwen2.5:7b --mlflow
# From the repository root, view the same local database:
evals/.venv/bin/mlflow ui --backend-store-uri sqlite:///evals/results/mlflow.db --host 127.0.0.1 --port 5000
```

Each model/phase gets an MLflow run with summary metrics and sample artifacts.
Per-case artifacts include errors and latency, not MLflow distributed tracing spans.
Keep all comparisons on the same hardware/settings; record Android device and
thermal conditions when adding a mobile backend. Mac results do not predict phone
latency. MLflow failure interrupts the experiment; JSONL remains available.
