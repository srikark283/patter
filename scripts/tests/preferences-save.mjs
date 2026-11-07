import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/features/dashboard/views/PreferencesView.tsx', 'utf8');
const start = source.indexOf('  const update = async');
const operation = source.slice(start, source.indexOf('\n  // Re-derives', start));
for (const fail of [false, true]) {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const calls = [];
  const context = {
    settings: { hotkey: 'old', command_hotkey: '', command_phrase: '' },
    savingRef: { current: false }, setSaving() {},
    setSettings: value => calls.push(['saved', value]), setCommandMode() {},
    updateSettings: async value => { calls.push(['write', value]); await pending; if (fail) throw Error('disk full'); },
    toast: { error() {} }
  };
  const update = new Function(...Object.keys(context), ts.transpile(operation + '\nreturn update;', { target: ts.ScriptTarget.ES2022 }))(...Object.values(context));
  const first = update({ hotkey: 'new' });
  await update({ hotkey: 'overlap' });
  assert.equal(calls.filter(c => c[0] === 'write').length, 1);
  assert.equal(calls.filter(c => c[0] === 'saved').length, 0);
  release(); await first;
  assert.equal(context.savingRef.current, false);
  assert.equal(calls.filter(c => c[0] === 'saved').length, fail ? 0 : 1);
}
console.log('Preferences saves: overlapping writes blocked, settings committed only after success.');
