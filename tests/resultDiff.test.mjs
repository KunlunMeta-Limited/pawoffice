import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createTestServer } from './helpers/vite.mjs'

let server, parseUnifiedDiff, schema
before(async () => {
  server = await createTestServer()
  ;({ parseUnifiedDiff } = await server.ssrLoadModule('/apps/web/src/results/diff.ts'))
  ;({ resultChangesSectionSchema: schema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
})
after(() => server?.close())

test('unified hunks retain old/new line numbers, including omitted counts and gaps', () => {
  const diff = '--- a/file.ts\r\n+++ b/file.ts\r\n@@ -8,3 +8,4 @@\r\n same\r\n-old\r\n+new\r\n+extra\r\n tail\r\n@@ -50 +51 @@ optional label\r\n-before\r\n+after\r\n'
  assert.deepEqual(parseUnifiedDiff(diff).lines, [
    { kind: 'hunk', text: '@@ -8,3 +8,4 @@' },
    { kind: 'context', text: 'same', oldLine: 8, newLine: 8 },
    { kind: 'deleted', text: 'old', oldLine: 9 },
    { kind: 'added', text: 'new', newLine: 9 },
    { kind: 'added', text: 'extra', newLine: 10 },
    { kind: 'context', text: 'tail', oldLine: 10, newLine: 11 },
    { kind: 'hunk', text: '@@ -50 +51 @@ optional label' },
    { kind: 'deleted', text: 'before', oldLine: 50 },
    { kind: 'added', text: 'after', newLine: 51 },
  ])
})

test('added/deleted files, header-like code and no-final-newline are preserved', () => {
  const added = parseUnifiedDiff('--- /dev/null\n+++ b/file\n@@ -0,0 +1,2 @@\n+++ literal\n+<script>alert(1)</script>\n\\ No newline at end of file')
  assert.equal(added.lines[1].text, '++ literal')
  assert.equal(added.lines[1].newLine, 1)
  assert.equal(added.lines[1].oldLine, undefined)
  assert.equal(added.lines[2].text, '<script>alert(1)</script>')
  assert.equal(added.lines[3].kind, 'note')
  const removed = parseUnifiedDiff('--- a/file\n+++ /dev/null\n@@ -1,2 +0,0 @@\n--- literal\n-')
  assert.deepEqual(removed.lines.slice(1), [
    { kind: 'deleted', text: '-- literal', oldLine: 1 },
    { kind: 'deleted', text: '', oldLine: 2 },
  ])
})

test('metadata is not code and rendered line counts stay bounded', () => {
  assert.deepEqual(parseUnifiedDiff('diff --git a/a b/a\n--- a/a\n+++ b/a').lines, [])
  const source = '@@ -0,0 +1,500 @@\n' + Array.from({ length: 500 }, () => '+code').join('\n')
  const result = parseUnifiedDiff(source)
  assert.equal(result.lines.length, 240)
  assert.equal(result.truncated, true)
  assert.equal(parseUnifiedDiff('@@ -1 +1 @@\n-before\n+after').truncated, false)
})

test('new diff fields are optional, strict, bounded and reject null', () => {
  const base = { kind: 'changes', id: 'changes', title: '变更', files: [{ path: 'src/a.ts' }] }
  const parsed = schema.parse(base)
  assert.equal(parsed.files[0].diff, '')
  assert.equal(parsed.files[0].diffTruncated, false)
  for (const patch of [{ diff: null }, { diff: 'x'.repeat(16001) }, { diffTruncated: 'true' }, { diff: {} }]) {
    assert.equal(schema.safeParse({ ...base, files: [{ path: 'src/a.ts', ...patch }] }).success, false)
  }
})

test('PowerShell fixture contains accurate full-file counts and all change types', async () => {
  const fixture = schema.parse(JSON.parse(await readFile(new URL('../integration/fixtures/result-file-changes.json', import.meta.url), 'utf8')))
  assert.deepEqual(new Set(fixture.files.map(file => file.status)), new Set(['added', 'modified', 'deleted', 'renamed']))
  for (const file of fixture.files.filter(file => !file.binary)) {
    const rows = parseUnifiedDiff(file.diff).lines
    assert.equal(rows.filter(row => row.kind === 'added').length, file.added, file.path)
    assert.equal(rows.filter(row => row.kind === 'deleted').length, file.deleted, file.path)
  }
})
