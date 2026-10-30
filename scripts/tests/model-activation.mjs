import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the actual UI operation with mocked IPC, including both failure stages.
const source = fs.readFileSync('src/features/dashboard/views/ModelsView.tsx', 'utf8');
const operation = source.slice(source.indexOf('  const run = async'), source.indexOf('  const renderCard'));
async function scenario(kind, activate, failure) {
  const events = [];
  const record = name => (...args) => events.push([name, ...args]);
  const ipc = name => async () => { events.push([name]); if (failure === name) throw Error(name); };
  const context = { operationLock: { current: false }, downloadingId: null, setOperation: record('operation'), setSetup: record('setup'), setError: record('error'), setDownloadingId: record('downloading'), downloadModel: ipc('download'), setEngine: ipc('activate'), deleteModel: ipc('delete'), setActiveEngine: record('active'), onModelDeleted: record('refresh'), setDeleteTarget: record('deleteTarget'), toast: { success: record('success'), error: record('toastError') } };
  const js = ts.transpile(operation + '\nreturn run;', { target: ts.ScriptTarget.ES2022 });
  const run = new Function(...Object.keys(context), js)(...Object.values(context));
  await run({ id: 'test', fullName: 'Test model' }, kind, activate);
  assert.equal(context.operationLock.current, false);
  assert.deepEqual(events.filter(event => event[0] === 'setup').at(-1)?.[1],
    failure || kind === 'delete' ? null : { id: 'test', stage: 2, activate: activate || kind === 'select' });
  return events.map(event => event[0]);
}
const activated = await scenario('download', true);
assert(activated.indexOf('download') < activated.indexOf('activate'));
assert(activated.indexOf('activate') < activated.indexOf('active'));
assert(!(await scenario('download', false)).includes('activate'));
assert(!(await scenario('download', true, 'download')).includes('activate'));
assert(!(await scenario('download', true, 'activate')).includes('active'));
assert((await scenario('select', false)).includes('active'));
console.log('Model activation: download-only, download-and-use, selection, and failures passed.');
