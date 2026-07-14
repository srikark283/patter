#!/usr/bin/env python3
"""Sync the models-v1 mirror release with the catalog in registry.rs.

The Rust CATALOG is the single source of truth. This script parses it,
ensures every file exists as a release asset named {variant_id}-{file_name},
uploads what's missing (downloading from the primary source on the runner),
and replaces assets whose size no longer matches.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "srikark283/patter")
TAG = "models-v1"
TOKEN = os.environ["GITHUB_TOKEN"]
REGISTRY = "src-tauri/src/models/registry.rs"


def api(path, method="GET", body=None, host="api.github.com"):
    req = urllib.request.Request(
        f"https://{host}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as r:
        data = r.read()
        return json.loads(data) if data else None


def parse_catalog():
    src = open(REGISTRY).read()
    files = []
    for vm in re.finditer(
        r'ModelVariant\s*\{\s*id:\s*"([^"]+)".*?base_url:\s*"([^"]+)".*?'
        r'dest_subdir:\s*"[^"]+".*?files:\s*&\[(.*?)\]\s*,?\s*\}',
        src,
        re.S,
    ):
        vid, base_url, files_block = vm.groups()
        for fm in re.finditer(r'ModelFile\s*\{\s*name:\s*"([^"]+)",\s*size:\s*([\d_]+)', files_block):
            name, size = fm.group(1), int(fm.group(2).replace("_", ""))
            files.append({"variant": vid, "name": name, "size": size, "base_url": base_url})
    if not files:
        sys.exit("FATAL: parsed zero files from registry.rs — catalog format changed?")
    return files


def main():
    files = parse_catalog()
    print(f"catalog: {len(files)} files")

    try:
        release = api(f"/repos/{REPO}/releases/tags/{TAG}")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        release = api(
            f"/repos/{REPO}/releases",
            "POST",
            {
                "tag_name": TAG,
                "name": "Speech model mirror v1",
                "prerelease": True,
                "body": "Mirror of the speech/diarization models Patter downloads, "
                "for networks that block huggingface.co. The app falls back to "
                "these automatically. Managed by the sync-models workflow.",
            },
        )
    rid = release["id"]
    assets = {a["name"]: a for a in api(f"/repos/{REPO}/releases/{rid}/assets?per_page=100")}

    failures = 0
    for f in files:
        asset_name = f"{f['variant']}-{f['name']}"
        existing = assets.get(asset_name)
        if existing and existing["size"] == f["size"]:
            print(f"ok      {asset_name}")
            continue
        if existing:
            print(f"replace {asset_name} (size {existing['size']} != {f['size']})")
            api(f"/repos/{REPO}/releases/assets/{existing['id']}", "DELETE")

        url = f"{f['base_url']}/{f['name']}?download=true"
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            path = tmp.name
        print(f"fetch   {asset_name} ({f['size']:,} B)")
        if subprocess.run(["curl", "-fsSL", "--retry", "3", "-o", path, url]).returncode != 0:
            print(f"FAIL fetch {asset_name}")
            failures += 1
            continue
        actual = os.path.getsize(path)
        if actual != f["size"]:
            print(f"FAIL size {asset_name}: got {actual}, catalog says {f['size']} — update registry.rs")
            failures += 1
            os.unlink(path)
            continue

        print(f"upload  {asset_name}")
        rc = subprocess.run(
            [
                "curl", "-fsS", "-X", "POST",
                "-H", f"Authorization: Bearer {TOKEN}",
                "-H", "Content-Type: application/octet-stream",
                "--data-binary", f"@{path}",
                f"https://uploads.github.com/repos/{REPO}/releases/{rid}/assets?name={asset_name}",
                "-o", "/dev/null",
            ]
        ).returncode
        os.unlink(path)
        if rc != 0:
            print(f"FAIL upload {asset_name}")
            failures += 1

    if failures:
        sys.exit(f"{failures} file(s) failed")
    print("mirror in sync")


if __name__ == "__main__":
    main()
