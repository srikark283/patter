#!/usr/bin/env python3
"""Sequential, local cleanup evaluation using requests exported from production Rust."""
import argparse
import hashlib
import json
import math
import platform
import random
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def normalize(text):
    # Preserve numbers, punctuation and line breaks: these are correctness signals.
    return text.strip().replace("\r\n", "\n")


def visible(raw):
    if "</think>" in raw:
        return raw.split("</think>", 1)[1]
    if raw.lstrip().startswith("<think>"):
        return ""
    return raw


def score(case, output):
    return normalize(output) in {normalize(x) for x in case["expected"]}


def percentile(values, quantile):
    return sorted(values)[max(0, math.ceil(len(values) * quantile) - 1)] if values else None


def post(path, payload, timeout=60):
    request = urllib.request.Request("http://127.0.0.1:11434" + path,
                                     json.dumps(payload).encode(), {"Content-Type": "application/json"})
    return urllib.request.urlopen(request, timeout=timeout)


def infer(payload):
    start = time.perf_counter()
    raw, first, final = "", None, None
    with post("/api/chat", payload) as response:
        for line in response:
            if not line.strip():
                continue
            chunk = json.loads(line)
            if "error" in chunk:
                raise RuntimeError(chunk["error"])
            raw += chunk.get("message", {}).get("content", "")
            if first is None and visible(raw).strip():
                first = (time.perf_counter() - start) * 1000
            if chunk.get("done"):
                final = chunk
                break
    elapsed = (time.perf_counter() - start) * 1000
    if final is None:
        raise RuntimeError("Stream ended without done=true")
    if final.get("done_reason") == "length":
        raise RuntimeError("Generation truncated at token limit")
    output = visible(raw).replace("[EMPTY]", "").strip()
    if not output:
        raise RuntimeError("Empty cleaned output")
    stats = {key: final[key] for key in ("load_duration", "prompt_eval_duration", "eval_duration",
             "total_duration", "prompt_eval_count", "prompt_eval_cached_count", "eval_count") if key in final}
    return output, {"wall_ms": elapsed, "first_text_ms": first, **stats}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--phase", choices=["warm", "cold"], default="warm")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-p95-ms", type=float)
    parser.add_argument("--mlflow", action="store_true")
    args = parser.parse_args()
    if args.repeats < 1 or (args.limit is not None and args.limit < 1):
        parser.error("repeats and limit must be positive")
    cases_path = Path(__file__).with_name("cases.json")
    cases = json.loads(cases_path.read_text())
    if args.limit:
        cases = cases[:args.limit]
    requests = json.loads(subprocess.run(
        ["cargo", "run", "--quiet", "--offline", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml"),
         "--example", "cleanup_requests"], input=json.dumps(cases), capture_output=True, text=True, check=True).stdout)
    stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + str(time.time_ns() % 1000000)
    destination = ROOT / "evals/results" / stamp
    destination.mkdir(parents=True)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    diff = subprocess.check_output(["git", "diff", "HEAD"], cwd=ROOT)
    with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=10) as response:
        models = {m["name"]: m for m in json.load(response)["models"]}
    metadata = dict(vars(args), revision=revision, tracked_diff_sha256=hashlib.sha256(diff).hexdigest(),
                    platform=platform.platform(), processor=platform.processor(),
                    ollama_version=json.load(urllib.request.urlopen("http://127.0.0.1:11434/api/version", timeout=10)),
                    cases_sha256=hashlib.sha256(cases_path.read_bytes()).hexdigest(),
                    requests_sha256=hashlib.sha256(json.dumps(requests, sort_keys=True).encode()).hexdigest())
    (destination / "metadata.json").write_text(json.dumps(metadata, indent=2))
    (destination / "requests.json").write_text(json.dumps(requests, indent=2))
    (destination / "cases.json").write_text(json.dumps(cases, indent=2))
    (destination / "working-tree.patch").write_bytes(diff)
    mlflow = None
    if args.mlflow:
        import mlflow
        mlflow.set_tracking_uri("sqlite:///" + str(ROOT / "evals/results/mlflow.db"))
        if mlflow.get_experiment_by_name("patter-cleanup") is None:
            mlflow.create_experiment("patter-cleanup", artifact_location=(ROOT / "evals/results/mlartifacts").as_uri())
        mlflow.set_experiment("patter-cleanup")
    summaries, failed = [], False
    for model in args.models:
        info = models.get(model) or models.get(model + ":latest")
        if info is None:
            raise RuntimeError(f"Model {model} is not installed; pull it explicitly first")
        if mlflow:
            mlflow.start_run(run_name=f"{model}-{args.phase}-{stamp}")
            mlflow.log_params({**metadata, "model": model, "model_digest": info["digest"]})
        rows = []
        try:
            if args.phase == "warm":
                warm = dict(requests[0], model=model, stream=False)
                warm["messages"] = warm["messages"][:-1]
                warm["options"] = dict(warm["options"], num_predict=1)
                with post("/api/chat", warm, timeout=180) as response:
                    result = json.load(response)
                    if "error" in result:
                        raise RuntimeError(result["error"])
            order = list(range(len(cases))) * args.repeats
            random.Random(args.seed).shuffle(order)
            for index in order:
                case = cases[index]
                row = dict(model=model, digest=info["digest"], phase=args.phase,
                           case_id=case["id"], category=case["category"], input=case["input"],
                           expected=case["expected"], sample=len(rows))
                started = time.perf_counter()
                try:
                    if args.phase == "cold":
                        with post("/api/generate", {"model": model, "keep_alive": 0}) as response:
                            result = json.load(response)
                            if "error" in result:
                                raise RuntimeError(result["error"])
                    output, stats = infer(dict(requests[index], model=model))
                    row.update(output=output, passed=score(case, output), **stats)
                except Exception as error:
                    row.update(passed=False, error=str(error), attempt_ms=(time.perf_counter()-started)*1000)
                rows.append(row)
                with (destination / "samples.jsonl").open("a") as file:
                    file.write(json.dumps(row) + "\n")
                print(f"{model} {case['id']}: {'PASS' if row['passed'] else 'FAIL'} "
                      f"{row.get('wall_ms', 0):.0f}ms", flush=True)
            times = [r["wall_ms"] for r in rows if "wall_ms" in r]
            summary = dict(model=model, phase=args.phase, samples=len(rows),
                           pass_rate=sum(r["passed"] for r in rows)/len(rows),
                           errors=sum("error" in r for r in rows),
                           p50_ms=percentile(times, .5), p95_ms=percentile(times, .95))
            summary["latency_passed"] = (args.max_p95_ms is None or
                (summary["p95_ms"] is not None and summary["p95_ms"] <= args.max_p95_ms))
            summaries.append(summary)
            failed |= summary["pass_rate"] < 1 or not summary["latency_passed"]
            if mlflow:
                mlflow.log_metrics({k: v for k, v in summary.items() if isinstance(v, (int, float))})
                mlflow.log_dict(rows, "samples.json")
                mlflow.log_dict(info, "model.json")
                for name in ("metadata.json", "requests.json", "cases.json", "working-tree.patch"):
                    mlflow.log_artifact(str(destination / name))
        finally:
            if mlflow:
                mlflow.end_run()
    (destination / "summary.json").write_text(json.dumps(summaries, indent=2))
    print(json.dumps(summaries, indent=2))
    print(f"Artifacts: {destination}")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
