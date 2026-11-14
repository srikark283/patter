"""Safe installer rejection and configuration/security boundary regression checks."""
import importlib.util
import json
import base64
import shutil
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]

class SecurityRegressions(unittest.TestCase):
    def test_installer_rejects_unsigned_or_missing_app_before_install(self):
        for scenario in ["signature-failure", "empty-archive", "invalid-code-signature"]:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                commands = base / 'bin'
                commands.mkdir()
                log = base / 'called'
                # No real downloader, extractor, installer or /Applications writer runs.
                fake = '''#!/usr/bin/env python3
import os,sys,pathlib,json,tempfile
name=pathlib.Path(sys.argv[0]).name
with open(os.environ['CALL_LOG'],'a') as f:f.write(name+' '+json.dumps(sys.argv[1:])+'\\n')
a=sys.argv[1:]; mode=os.environ['SCENARIO']
if name=='uname': print('Darwin arm64')
elif name=='mktemp': print(tempfile.mkdtemp(dir=os.environ['TEST_DIRECTORY']))
elif name=='curl':
 p=pathlib.Path(a[a.index('-o')+1]); p.write_text('"browser_download_url": "https://github.com/srikark283/patter/releases/download/test/Patter.app.tar.gz"' if p.name=='release.json' else 'fixture')
elif name=='minisign': sys.exit(1 if mode=='signature-failure' else 0)
elif name=='tar' and mode=='invalid-code-signature': pathlib.Path(a[a.index('-C')+1],'Patter.app').mkdir()
elif name=='codesign': sys.exit(1)
elif name in ['ditto','mv']: raise SystemExit('Unexpected installation side effect')
'''
                for command in ['uname','mktemp','curl','base64','minisign','tar','codesign','ditto','mv']:
                    p = commands / command
                    p.write_text(fake)
                    p.chmod(0o755)
                env = dict(os.environ, PATH=str(commands)+os.pathsep+os.environ['PATH'], CALL_LOG=str(log), SCENARIO=scenario, TEST_DIRECTORY=str(base))
                result = subprocess.run(['sh', str(ROOT/'install.sh')], env=env, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                calls=log.read_text()
                self.assertNotIn('ditto ', calls)
                self.assertNotIn('mv ', calls)
                if scenario=='signature-failure': self.assertNotIn('tar ', calls)

    @unittest.skipUnless(shutil.which("minisign"), "minisign is required for the real signature compatibility test")
    def test_tauri_signatures_verify_and_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)
            key=path/'key'
            cli=ROOT/'node_modules/.bin/tauri'
            subprocess.run([str(cli),'signer','generate','--ci','-p','','-w',str(key)],capture_output=True,check=True)
            artifact=path/'fixture'
            artifact.write_bytes(b'harmless installer fixture')
            subprocess.run([str(cli),'signer','sign','-f',str(key),'-p','',str(artifact)],capture_output=True,check=True)
            public=base64.b64decode(Path(str(key)+'.pub').read_bytes()).decode().splitlines()[1]
            signature=path/'signature'
            signature.write_bytes(base64.b64decode(Path(str(artifact)+'.sig').read_bytes()))
            command=['minisign','-Vm',str(artifact),'-x',str(signature),'-P',public]
            self.assertEqual(subprocess.run(command,capture_output=True).returncode,0)
            artifact.write_bytes(b'tampered installer fixture')
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)

    def test_hud_has_no_data_or_install_permissions(self):
        hud=json.loads((ROOT/'src-tauri/capabilities/hud.json').read_text())
        self.assertEqual(set(hud['permissions']) & {'allow-get-settings','allow-get-history','allow-import-data','allow-install-update','core:default'}, set())
        self.assertEqual(hud['windows'], ['main'])
        dashboard=json.loads((ROOT/'src-tauri/capabilities/default.json').read_text())
        self.assertNotIn('main', dashboard['windows'])
        self.assertIn('allow-set-hud-visible', hud['permissions'])
        self.assertNotIn('allow-set-hud-visible', dashboard['permissions'])
        commands=set(re.findall(r'commands::(\w+)',(ROOT/'src-tauri/src/main.rs').read_text().split('.invoke_handler(')[1]))
        declared=set(re.findall(r'"(\w+)"',(ROOT/'src-tauri/build.rs').read_text()))
        self.assertEqual(commands,declared)

    def test_installers_pin_the_configured_updater_key(self):
        configured=json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())['plugins']['updater']['pubkey']
        key=base64.b64decode(configured).decode().splitlines()[1]
        for installer in ['install.sh','install.ps1']:
            self.assertIn(key,(ROOT/installer).read_text())
        for workflow in (ROOT/'.github/workflows').glob('*.yml'):
            for reference in re.findall(r'uses:\s*([^\s#]+)',workflow.read_text()):
                self.assertRegex(reference,r'^[\w.-]+/[\w./-]+@[0-9a-f]{40}$')

    def test_production_csp_and_no_raw_content_logs(self):
        policy=json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())['app']['security']['csp']
        self.assertIn("script-src 'self'",policy)
        self.assertIn("object-src 'none'",policy)
        self.assertNotIn('unsafe-eval',policy)
        source=(ROOT/'src-tauri/src/recording.rs').read_text()
        self.assertNotRegex(source,r'println!\("(?:Transcript:|Cleaned:|\[command\] instruction=)')

    def test_mirror_pins_and_hashes_match_the_catalog(self):
        spec=importlib.util.spec_from_file_location('mirror',ROOT/'.github/scripts/sync_model_mirror.py')
        mirror=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mirror)
        files=mirror.parse_catalog()
        self.assertEqual(len(files),18)
        for file in files:
            self.assertRegex(file['base_url'],r'/resolve/[0-9a-f]{40}$')
            self.assertRegex(file['sha256'],r'^[0-9a-f]{64}$')

if __name__=='__main__':
    os.chdir(ROOT)
    unittest.main()
