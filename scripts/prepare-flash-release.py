#!/usr/bin/env python3
"""Prepare or download the pinned Flash release without putting weights in Git."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'native/patter-intelligence/patter-flash.json'
NOTICES = ROOT / 'native/patter-intelligence/flash-notices'


def verify(path, entry):
    if path.stat().st_size != entry['size']:
        raise ValueError(f"Wrong size: {entry['name']}")
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != entry['sha256']:
        raise ValueError(f"Wrong SHA-256: {entry['name']}")


def prepare(source, output, download=False):
    manifest = json.loads(MANIFEST.read_text())
    output.mkdir(parents=True, exist_ok=True)
    for entry in manifest['files']:
        name = entry['name']
        if Path(name).name != name:
            raise ValueError(f'Invalid asset name: {name}')
        target = output / name
        temporary = output / (name + '.part')
        try:
            if download:
                subprocess.run(['curl', '--fail', '--location', '--retry', '3',
                                '--silent', '--show-error', '--output', str(temporary),
                                manifest['base_url'] + '/' + name], check=True)
            else:
                origin = source / name
                if not origin.is_file():
                    origin = NOTICES / name
                verify(origin, entry)
                shutil.copyfile(origin, temporary)
            verify(temporary, entry)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    shutil.copyfile(MANIFEST, output / 'patter-flash.json')
    if not download:
        with tarfile.open(output / 'patter-flash-mlx-4bit.tar.gz', 'w:gz') as archive:
            for name in [entry['name'] for entry in manifest['files']] + ['patter-flash.json']:
                archive.add(output / name, arcname='patter-flash/' + name)
    print(f"Verified {len(manifest['files'])} Flash files in {output}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--source', type=Path, help='Local 4-bit MLX export folder')
    group.add_argument('--download', action='store_true', help='Verify the published release')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output, args.download)
