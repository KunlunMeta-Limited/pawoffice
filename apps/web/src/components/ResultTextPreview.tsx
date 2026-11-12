import { useMemo, useState } from 'react'
import type { Node } from 'jsonc-parser'
import { codeLanguage, filePreviewKind, maxCsvRows, parseCsvPreview, parseJsonPreview } from '../results/filePreview.ts'
import { ResultCodeBlock } from './ResultCodeBlock.tsx'
import { ResultMarkdown } from './ResultMarkdown.tsx'
import './ResultFilePreview.css'

function Source({ text, language = '' }: { text: string; language?: string }) {
  const truncated = text.length > 200000
  return <>
    {truncated && <p className="result-file-notice">源文较长，仅预览前200000个字符；下载原件可查看完整内容。</p>}
    <ResultCodeBlock text={text.slice(0, 200000)} language={language} copyLabel={truncated ? '复制预览内容' : '复制源文'} />
  </>
}

function CsvPreview({ text, tsv }: { text: string; tsv: boolean }) {
  const [source, setSource] = useState(false)
  const [header, setHeader] = useState(true)
  const [delimiter, setDelimiter] = useState(tsv ? '\t' : '')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(25)
  const parsed = useMemo(() => parseCsvPreview(text, delimiter), [text, delimiter])
  const rows = parsed.rows ?? []
  const data = header ? rows.slice(1) : rows
  const limited = parsed.limited || data.length > maxCsvRows
  const loaded = data.slice(0, maxCsvRows)
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const filtered = loaded.map((row, index) => ({ row, index })).filter(({ row }) => !search || row.some(value => value.toLowerCase().includes(search.toLowerCase())))
  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const current = Math.min(page, pages - 1)
  const displayed = filtered.slice(current * size, (current + 1) * size)
  const ragged = rows.some(row => row.length !== rows[0]?.length)
  return <section className="result-data-preview" aria-label="CSV预览">
    <div className="result-file-tools"><strong>CSV表格</strong>
      <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>表格</button>
      <button type="button" aria-pressed={source} onClick={() => setSource(true)}>源文</button>
    </div>
    {source ? <Source text={text} /> : <>
      <div className="result-csv-controls">
        <label><input type="checkbox" checked={header} onChange={event => { setHeader(event.target.checked); setPage(0) }} />首行为表头</label>
        <label>分隔符<select value={delimiter} onChange={event => { setDelimiter(event.target.value); setPage(0) }}><option value="">自动识别</option><option value=",">逗号</option><option value=";">分号</option><option value={'\t'}>制表符</option></select></label>
        <label>筛选已载入行<input type="search" aria-label="筛选已载入行（搜索CSV内容）" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="输入关键词" /></label>
      </div>
      {parsed.error ? <p className="result-file-error" role="alert">{parsed.error}</p> : <>
        <p className="result-file-caption" role="status">{loaded.length} 行数据 · {columns} 列{search && ` · 匹配 ${filtered.length} 行`}{limited && ' · 仅载入前10000行，完整内容请下载原件'}</p>
        {ragged && <p className="result-file-notice">部分行的列数不一致，缺少的单元格留空，额外列仍保留。</p>}
        {rows.length ? <div className="result-csv-scroll" role="region" aria-label="CSV数据表格" tabIndex={0}><table>
          <caption className="result-workspace-sr-only">CSV数据</caption>
          <thead><tr><th scope="col">行</th>{Array.from({ length: columns }, (_, i) => <th scope="col" key={i}>{header ? rows[0]?.[i] || `第${i + 1}列（无表头）` : `第${i + 1}列`}</th>)}</tr></thead>
          <tbody>{displayed.map(({ row, index }) => <tr key={index}><th scope="row">{index + 1}</th>{Array.from({ length: columns }, (_, i) => <td key={i}>{row[i] ?? ''}</td>)}</tr>)}</tbody>
        </table></div> : <p className="result-file-caption">CSV文件为空。</p>}
        {rows.length > 0 && !filtered.length && <p className="result-file-caption">没有匹配的数据行。</p>}
        {filtered.length > 25 && <div className="result-csv-pages">
          <label>每页<select aria-label="CSV每页行数" value={size} onChange={event => { setSize(Number(event.target.value)); setPage(0) }}>{[25, 50, 100].map(count => <option key={count} value={count}>{count}行</option>)}</select></label>
          {pages > 1 && <><span>第 {current + 1} / {pages} 页</span>
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button>
          <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>下一页</button></>}
        </div>}
      </>}
    </>}
  </section>
}

function JsonNode({ node, text, label = '根节点', initiallyOpen = false }: { node: Node; text: string; label?: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const [visible, setVisible] = useState(50)
  const [fullValue, setFullValue] = useState(false)
  const children = node.children ?? []
  const container = node.type === 'object' || node.type === 'array'
  const raw = text.slice(node.offset, node.offset + node.length)
  if (!container) return <div className="result-json-value"><span className="result-json-key">{label}:</span>{' '}
    <span data-json-type={node.type}>{raw.length > 300 && !fullValue ? `${raw.slice(0, 300)}…` : raw}</span>
    {raw.length > 300 && <button type="button" onClick={() => setFullValue(value => !value)}>{fullValue ? '收起值' : '展开完整值'}</button>}
  </div>
  return <details className="result-json-node" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open) }}>
    <summary><span className="result-json-key">{label}</span><span>{node.type === 'array' ? `Array [${children.length}]` : `Object {${children.length}}`}</span></summary>
    {open && <div className="result-json-children">{children.slice(0, visible).map((child, index) => child.type === 'property'
      ? <JsonNode key={child.offset} node={child.children![1]} text={text} label={text.slice(child.children![0].offset, child.children![0].offset + child.children![0].length)} />
      : <JsonNode key={child.offset} node={child} text={text} label={String(index)} />)}
      {children.length > visible && <button className="result-json-more" type="button" onClick={() => setVisible(value => value + 50)}>再显示{Math.min(50, children.length - visible)}项（剩余{children.length - visible}项）</button>}
    </div>}
  </details>
}

function JsonPreview({ text }: { text: string }) {
  const parsed = useMemo(() => parseJsonPreview(text), [text])
  const [source, setSource] = useState(false)
  const [treeState, setTreeState] = useState({ epoch: 0, open: true })
  return <section className="result-data-preview" aria-label="JSON预览">
    <div className="result-file-tools"><strong>JSON</strong>
      <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>树状</button>
      <button type="button" aria-pressed={source} onClick={() => setSource(true)}>源文</button>
      {!source && parsed.root && <><button type="button" onClick={() => setTreeState(value => ({ epoch: value.epoch + 1, open: true }))}>展开顶层</button>
        <button type="button" onClick={() => setTreeState(value => ({ epoch: value.epoch + 1, open: false }))}>全部收起</button></>}
    </div>
    {source ? <Source text={text} language="json" /> : parsed.error ? <p className="result-file-error" role="alert">{parsed.error}</p>
      : <div className="result-json-tree" tabIndex={0} role="region" aria-label="JSON树"><JsonNode key={treeState.epoch} node={parsed.root!} text={text} initiallyOpen={treeState.open} /></div>}
  </section>
}

export function ResultTextPreview({ text, mimeType, title }: { text: string; mimeType: string; title: string }) {
  const kind = filePreviewKind(mimeType, title)
  if (kind === 'csv' || kind === 'tsv') return <CsvPreview text={text} tsv={kind === 'tsv'} />
  if (kind === 'json') return <JsonPreview text={text} />
  if (kind === 'markdown') return <div className="result-markdown-document">
    {text.length > 200000 && <p className="result-file-notice">正文较长，当前仅预览部分内容，可下载该版本查看完整文件。</p>}
    <ResultMarkdown content={text.slice(0, 200000)} />
  </div>
  return <Source text={text} language={codeLanguage(mimeType, title)} />
}
