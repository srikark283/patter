import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/features/dashboard/views/AIView.tsx', 'utf8');
const operation = source.slice(source.indexOf('  const removeDownload = async'), source.indexOf('  // Returning null'));
async function scenario(fail) {
  const calls = [];
  const cache = { 'patter-1-nano': { installed: true }, 'patter-1-mini': { installed: true } };
  const context = { deleteTarget: { model: 'patter-1-mini' }, setupLock: { current: false }, savingRef: { current: false }, modelChoiceRef: { current: 'patter-1-mini' }, setRemovingModel: value => calls.push(['removing', value]), setDeleteError: value => calls.push(['error', value]), deleteBuiltInModel: async model => { calls.push(['delete', model]); if (fail) throw Error('Model in use'); }, getBuiltInStatus: async () => ({ installed: false, storage_bytes: 0 }), setDeleteTarget: value => calls.push(['target', value]), setModelStatuses: update => Object.assign(cache, update(cache)), setBuiltInStatus: status => calls.push(['status', status.installed]), builtInModelName: model => model, toast: { success: value => calls.push(['toast', value]) } };
  const remove = new Function(...Object.keys(context), ts.transpile(operation + '\nreturn removeDownload;', { target: ts.ScriptTarget.ES2022 }))(...Object.values(context));
  await Promise.all([remove(), remove()]);
  assert.equal(context.setupLock.current, false);
  assert.equal(calls.filter(call => call[0] === 'delete').length, 1);
  assert.equal(cache['patter-1-nano'].installed, true);
  assert.equal(cache['patter-1-mini'].installed, fail);
  assert.equal(calls.some(call => call[0] === 'target'), !fail);
  assert(calls.some(call => call[0] === 'removing' && call[1] === null));
  if (fail) assert(calls.some(call => call[0] === 'error' && call[1].includes('Model in use')));
}
await scenario(false);
await scenario(true);
console.log('Model removal UI: duplicate clicks blocked, cache refreshed, errors retain confirmation, other model preserved.');
