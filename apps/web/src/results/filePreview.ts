import Papa from 'papaparse'
import { createScanner, parseTree } from 'jsonc-parser'
import type { Node, ParseError } from 'jsonc-parser'

export const maxStructuredPreviewCharacters = 500000
export const maxCsvRows = 10000

export function filePreviewKind(mimeType: string, title: string) {
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  const ext = title.toLowerCase().split('.').at(-1) ?? ''
  const generic = ['text/plain', 'application/octet-stream', ''].includes(mime)
  if (mime === 'text/csv' || generic && ext === 'csv') return 'csv'
  if (mime === 'text/tab-separated-values' || generic && ext === 'tsv') return 'tsv'
  if (mime === 'application/json' || mime.endsWith('+json') || generic && ext === 'json') return 'json'
  if (mime === 'text/markdown' || generic && ['md', 'markdown'].includes(ext)) return 'markdown'
  return mime.startsWith('text/') || ['application/javascript', 'application/xml'].includes(mime) || generic && ['js', 'jsx', 'ts', 'tsx', 'py', 'css', 'html', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'sql', 'txt'].includes(ext) ? 'code' : 'unsupported'
}

export function codeLanguage(mime: string, title: string) {
  const ext = title.toLowerCase().split('.').at(-1) ?? ''
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'ps1', 'sql'].includes(ext)) return ext
  return mime.includes('javascript') ? 'javascript' : mime.includes('xml') ? 'xml' : ''
}

export function parseCsvPreview(text: string, delimiter = '') {
  if (text.length > maxStructuredPreviewCharacters) return { error: 'CSV内容较大，当前不生成表格，请查看源文或下载原件。' } as const
  if (!text.length) return { rows: [], limited: false, delimiter: delimiter || ',', error: '' }
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { delimiter, preview: maxCsvRows + 2, skipEmptyLines: false, dynamicTyping: false })
  const fatal = parsed.errors.find(error => error.type === 'Quotes')
  if (fatal) return { error: `CSV引号格式不正确${fatal.row === undefined ? '' : `（第${fatal.row + 1}条记录）`}，请查看源文。` } as const
  const rows = parsed.data
  // Drop only the parser's synthetic final record; real interior blank records remain.
  if (!parsed.meta.truncated && /(?:\r\n|\r|\n)$/.test(text) && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop()
  if (rows.some(row => row.length > 100)) return { error: 'CSV列数超过100列，请查看源文或下载原件。' } as const
  return { rows: rows.slice(0, maxCsvRows + 1), limited: Boolean(parsed.meta.truncated || rows.length > maxCsvRows + 1), delimiter: parsed.meta.delimiter, error: '' }
}

export function parseJsonPreview(text: string): { root?: Node; error: string } {
  if (text.length > maxStructuredPreviewCharacters) return { error: 'JSON内容较大，当前不生成树状视图，请查看源文或下载原件。' }
  const source = text.replace(/^\uFEFF/, ' ')
  const scanner = createScanner(source, true)
  let depth = 0, count = 0
  for (;;) {
    scanner.scan()
    const token = source.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength())
    if (!token && scanner.getPosition() >= source.length) break
    if (++count > 50000) return { error: 'JSON节点过多，请查看源文或下载原件。' }
    if (token === '{' || token === '[') depth++
    if (depth > 32) return { error: 'JSON嵌套超过32层，请查看源文或下载原件。' }
    if (token === '}' || token === ']') depth--
  }
  const errors: ParseError[] = []
  const root = parseTree(source, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false })
  if (errors.length || !root) {
    const offset = errors[0]?.offset ?? 0
    const preceding = source.slice(0, offset).split(/\r\n|\r|\n/)
    return { error: `JSON格式不正确（第${preceding.length}行，第${preceding.at(-1)!.length + 1}列），请查看源文。` }
  }
  return { root, error: '' }
}
