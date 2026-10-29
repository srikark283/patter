import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/features/dashboard/views/AIView.tsx', 'utf8');
const operation = source.slice(source.indexOf('  const setUpBuiltIn = async'), source.indexOf('  const [checkingOllama'));
async function scenario(fail = false) {
  const calls = [];
  const context = { modelChoice: 'patter-1-nano', setupLock: { current: false }, savingRef: { current: false }, setSetupBusy() {}, setBuiltInError() {}, enableBuiltInModel: async model => { calls.push(['enable', model]); if(fail) throw Error('failed'); return { built_in_model: model }; }, setSettings: settings => calls.push(['saved', settings.built_in_model]), setProviderChoice() {}, refreshBuiltIn: async () => {}, setManagedProvider() {}, builtInModelName: model => model, toast: { success() {} } };
  const run = new Function(...Object.keys(context), ts.transpile(operation + '\nreturn setUpBuiltIn;', {target:ts.ScriptTarget.ES2022}))(...Object.values(context));
  await Promise.all([run(undefined, 'patter-1-mini'), run(undefined, 'patter-1-mini')]);
  assert.equal(context.setupLock.current, false);
  assert.deepEqual(calls.filter(call => call[0] === 'enable'), [['enable','patter-1-mini']]);
  assert.deepEqual(calls.filter(call => call[0] === 'saved'), fail ? [] : [['saved','patter-1-mini']]);
}
await scenario();
await scenario(true);
console.log('Intelligence activation: explicit clicked model, duplicate-click guard, previous settings retained on failure.');
