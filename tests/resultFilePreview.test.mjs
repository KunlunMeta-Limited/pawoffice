import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, files, highlight, Preview
before(async () => {
  server = await createTestServer()
  files = await server.ssrLoadModule('/apps/web/src/results/filePreview.ts')
  highlight = await server.ssrLoadModule('/apps/web/src/results/highlight.ts')
  ;({ ResultTextPreview: Preview } = await server.ssrLoadModule('/apps/web/src/components/ResultTextPreview.tsx'))
})
after(() => server?.close())

test('file classification respects explicit MIME and supports generic named files', () => {
  assert.equal(files.filePreviewKind('text/csv; charset=utf-8', '记录'), 'csv')
  assert.equal(files.filePreviewKind('text/plain', '预算.CSV'), 'csv')
  assert.equal(files.filePreviewKind('application/vnd.example+json', '配置'), 'json')
  assert.equal(files.filePreviewKind('application/octet-stream', 'config.json'), 'json')
  assert.equal(files.filePreviewKind('application/pdf', 'config.json'), 'unsupported')
  assert.equal(files.filePreviewKind('text/typescript', 'budget.ts'), 'code')
})

test('CSV preserves quoted newlines, commas, escaped quotes, leading zeros and empty records', () => {
  const source = '\uFEFF编号,备注,值\r\n0001,"包含,逗号\n和换行",12\r\n0002,"她说""好""",\r\n\r\n'
  const parsed = files.parseCsvPreview(source, ',')
  assert.equal(parsed.error, '')
  assert.deepEqual(parsed.rows, [['编号', '备注', '值'], ['0001', '包含,逗号\n和换行', '12'], ['0002', '她说"好"', ''], ['']])
  assert.equal(files.parseCsvPreview('').rows.length, 0)
  assert.deepEqual(files.parseCsvPreview('a;b\n1;2', ';').rows, [['a', 'b'], ['1', '2']])
  assert.deepEqual(files.parseCsvPreview('a\tb\n1\t2', '\t').rows, [['a', 'b'], ['1', '2']])
})

test('CSV reports bad quotes and bounds rows, columns and input length', () => {
  assert.match(files.parseCsvPreview('a,b\n1,"not closed', ',').error, /引号格式/)
  const many = files.parseCsvPreview('a\n' + Array.from({ length: 10050 }, (_, i) => String(i)).join('\n'), ',')
  assert(many.limited); assert.equal(many.rows.length, 10001)
  assert.match(files.parseCsvPreview(Array(101).fill('a').join(','), ',').error, /100列/)
  assert.match(files.parseCsvPreview('x'.repeat(500001)).error, /内容较大/)
})

test('JSON uses source offsets, preserving large numbers, duplicate keys, null and prototype names', () => {
  const source = '{"n":123456789012345678901,"n":2,"__proto__":{"ok":true},"missing":null}'
  const parsed = files.parseJsonPreview(source)
  assert.equal(parsed.error, '')
  assert.equal(parsed.root.children.length, 4)
  const number = parsed.root.children[0].children[1]
  assert.equal(source.slice(number.offset, number.offset + number.length), '123456789012345678901')
  const html = renderToStaticMarkup(createElement(Preview, { text: source, mimeType: 'application/json', title: 'config.json' }))
  assert(html.includes('123456789012345678901')); assert(html.includes('__proto__')); assert(html.includes('null'))
  assert.equal({}.ok, undefined)
})

test('invalid, deep, large and empty JSON produce explicit errors rather than partial trees', () => {
  for (const input of ['{"x":}', '{"x":1,}', '{/* comment */"x":1}', '']) assert.match(files.parseJsonPreview(input).error, /格式不正确/)
  assert.match(files.parseJsonPreview('['.repeat(33) + '0' + ']'.repeat(33)).error, /32层/)
  assert.equal(files.parseJsonPreview('{"text":"[[[{\\\""}').error, '')
  assert.match(files.parseJsonPreview(' '.repeat(500001)).error, /内容较大/)
  assert.equal(files.parseJsonPreview('\uFEFF{"x":1}').error, '')
})

test('code highlighting emits text tokens without executing markup; unsupported languages stay readable', () => {
  const source = 'const title = "<img src=x onerror=alert(1)>"\n'
  const tree = highlight.highlightCode(source, 'typescript')
  const flatten = node => node.type === 'text' ? node.value : (node.children ?? []).map(flatten).join('')
  assert.equal(flatten(tree), source)
  assert(tree.children.some(node => node.type === 'element'))
  assert.equal(highlight.highlightCode(source, 'unknown-language'), null)
  assert.equal(highlight.highlightCode('x'.repeat(20001), 'javascript'), null)
})
