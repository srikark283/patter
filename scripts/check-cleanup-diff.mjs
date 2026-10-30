import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/cleanup-diff.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { cleanupDiff } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
for (const [original, result] of [['', ''], ['', 'Hello.'], ['um hello', 'Hello.'], ['keep this exactly', 'keep this exactly'], ['send friday no wait thursday', 'Send Thursday.'], ['こんにちは 世界', 'こんにちは、世界。'], ['a '.repeat(1000), 'a '.repeat(999) + 'changed']]) {
  const diff = cleanupDiff(original, result);
  assert.equal(diff.original.map(part => part.text).join(''), original);
  assert.equal(diff.result.map(part => part.text).join(''), result);
  if (original === result) assert.ok(diff.result.every(part => !part.changed));
}
const punctuation = cleanupDiff('Hello world', 'Hello, world.');
assert.deepEqual(punctuation.result.filter(part => part.changed).map(part => part.text), [',', '.']);
const deletion = cleanupDiff('um hello', 'hello');
assert.equal(deletion.original.filter(part => part.changed).map(part => part.text).join(''), 'um ');
console.log('Cleanup diff: round trips, punctuation, deletions, Unicode, and bounded long-input fallback pass.');

const correction = cleanupDiff('so um send the report by friday no wait thursday', 'Send the report by Thursday.');
const removedWords = correction.original.filter(part => part.changed).map(part => part.text).join(' ').trim().split(/\s+/);
assert.deepEqual(removedWords, ['so', 'um', 'friday', 'no', 'wait']);
assert.equal(correction.result.filter(part => part.changed).map(part => part.text).join(' '), 'Send Thursday.');
for (const text of ['hello world', 'hello '.repeat(600)]) {
 const casing = cleanupDiff(text, text.toUpperCase());
 assert.ok(casing.original.every(part => !part.changed));
 assert.equal(casing.result.map(part => part.text).join(''), text.toUpperCase());
 assert.ok(casing.result.some(part => part.changed));
}
console.log('Capitalization changes preserve original words, including long inputs.');
