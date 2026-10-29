export type DiffLine = {
  kind: 'context' | 'added' | 'deleted' | 'hunk' | 'note'
  text: string
  oldLine?: number
  newLine?: number
}

/** A single-file unified diff. Headers are metadata; only hunk content receives line numbers. */
export function parseUnifiedDiff(source: string, limit = 240): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = []
  let oldLine = 0, newLine = 0, oldRemaining = 0, newRemaining = 0
  for (const text of source.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(text)
    let line: DiffLine | undefined
    if (hunk) {
      const values = [Number(hunk[1]), Number(hunk[3]), Number(hunk[2] ?? 1), Number(hunk[4] ?? 1)]
      if (!values.every(Number.isSafeInteger)) continue
      ;[oldLine, newLine, oldRemaining, newRemaining] = values
      line = { kind: 'hunk', text }
    } else if (text === '\\ No newline at end of file' && lines.length) {
      line = { kind: 'note', text: '文件末尾无换行' }
    } else if (text.startsWith('+') && newRemaining > 0) {
      line = { kind: 'added', text: text.slice(1), newLine: newLine++ }
      newRemaining--
    } else if (text.startsWith('-') && oldRemaining > 0) {
      line = { kind: 'deleted', text: text.slice(1), oldLine: oldLine++ }
      oldRemaining--
    } else if (text.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
      line = { kind: 'context', text: text.slice(1), oldLine: oldLine++, newLine: newLine++ }
      oldRemaining--; newRemaining--
    }
    if (!line) continue
    if (lines.length >= limit) return { lines, truncated: true }
    lines.push(line)
  }
  return { lines, truncated: false }
}

/** Bounded line comparison for two already-resolved document revisions. Never reads a working path. */
export function compareArtifactText(before: string, after: string) {
  if (before.length + after.length > 200000) return { lines: [] as DiffLine[], truncated: false, coarse: false, tooLarge: true }
  const a = before.replace(/\r\n/g, '\n').split('\n'), b = after.replace(/\r\n/g, '\n').split('\n')
  let prefix = 0, suffix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  if (prefix === a.length && prefix === b.length) return { lines: [] as DiffLine[], truncated: false, coarse: false, tooLarge: false }
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++
  const old = a.slice(prefix, a.length - suffix), next = b.slice(prefix, b.length - suffix)
  const coarse = (old.length + 1) * (next.length + 1) > 500000
  const rows: DiffLine[] = []
  let oldLine = Math.max(0, prefix - 3) + 1, newLine = oldLine
  const context = (text: string) => rows.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ })
  for (const text of a.slice(Math.max(0, prefix - 3), prefix)) context(text)
  if (coarse) {
    for (const text of old) rows.push({ kind: 'deleted', text, oldLine: oldLine++ })
    for (const text of next) rows.push({ kind: 'added', text, newLine: newLine++ })
  } else {
    const columns = next.length + 1, grid = new Uint32Array((old.length + 1) * columns)
    for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) {
      grid[i * columns + j] = old[i] === next[j] ? grid[(i + 1) * columns + j + 1] + 1
        : Math.max(grid[(i + 1) * columns + j], grid[i * columns + j + 1])
    }
    let i = 0, j = 0
    while (i < old.length || j < next.length) {
      if (i < old.length && j < next.length && old[i] === next[j]) { context(old[i]); i++; j++ }
      else if (i < old.length && (j === next.length || grid[(i + 1) * columns + j] >= grid[i * columns + j + 1])) {
        rows.push({ kind: 'deleted', text: old[i++], oldLine: oldLine++ })
      } else rows.push({ kind: 'added', text: next[j++], newLine: newLine++ })
    }
  }
  for (const text of a.slice(a.length - suffix, a.length - suffix + Math.min(3, suffix))) context(text)
  const folded: DiffLine[] = []
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== 'context') { folded.push(rows[i++]); continue }
    let end = i
    while (end < rows.length && rows[end].kind === 'context') end++
    if (end - i > 6) folded.push(...rows.slice(i, i + 3), { kind: 'note', text: `省略 ${end - i - 6} 行未修改内容` }, ...rows.slice(end - 3, end))
    else folded.push(...rows.slice(i, end))
    i = end
  }
  return { lines: folded.slice(0, 240), truncated: folded.length > 240, coarse, tooLarge: false }
}
