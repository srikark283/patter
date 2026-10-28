import sys
sys.dont_write_bytecode = True

import importlib.util
import json
import hashlib
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('flash_release', Path(__file__).with_name('prepare-flash-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseCheck(unittest.TestCase):
    def test_package_and_reject_corruption(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            data = b'model bytes'
            (source / 'model.safetensors').write_bytes(data)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'files': [{'name': 'model.safetensors', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}))
            previous = release.MANIFEST
            release.MANIFEST = manifest
            try:
                output = root / 'output'
                release.prepare(source, output)
                with tarfile.open(output / 'patter-flash-mlx-4bit.tar.gz') as archive:
                    self.assertEqual(set(archive.getnames()), {'patter-flash/model.safetensors', 'patter-flash/patter-flash.json'})
                (source / 'model.safetensors').write_bytes(b'broken!!!!!')
                with self.assertRaisesRegex(ValueError, 'SHA-256'):
                    release.prepare(source, root / 'bad')
                self.assertFalse((root / 'bad/model.safetensors').exists())
                self.assertFalse((root / 'bad/model.safetensors.part').exists())
            finally:
                release.MANIFEST = previous


if __name__ == '__main__':
    unittest.main()
