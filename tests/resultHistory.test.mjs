import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, ui, integration, resources, presentation, format, diff, OfficeState, Workspace, fixture
before(async () => {
  server = await createTestServer()
  ui = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts')
  integration = await server.ssrLoadModule('/packages/protocol/src/office-integration.ts')
  resources = await server.ssrLoadModule('/apps/web/src/results/resources.ts')
  presentation = await server.ssrLoadModule('/apps/web/src/results/presentation.ts')
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
  diff = await server.ssrLoadModule('/apps/web/src/results/diff.ts')
  ;({ OfficeState } = await server.ssrLoadModule('/server/src/officeState.ts'))
  ;({ ResultWorkspace: Workspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  fixture = JSON.parse(await readFile(new URL('../integration/fixtures/result-deliveries.json', import.meta.url), 'utf8'))
})
after(() => server?.close())
const hash = text => createHash('sha256').update(text).digest('hex')
const snapshot = (board, seq = 1, conversationId = 'main') => integration.officeSnapshotSchema.parse({
  schemaVersion: '1.0', seq, workspace: { id: 'history-demo', name: '版本测试' }, conversations: [{ id: conversationId, title: '交付', whiteboard: board }],
})

test('legacy payloads remain valid while history binds each artifact to a specific version', () => {
  const old = ui.whiteboardTaskBoardSchema.parse({ title: '旧数据', result: { artifacts: [{ id: 'a', title: '旧文档', content: '正文' }] } })
  assert.deepEqual(old.deliveries, [])
  assert.equal(old.result.artifacts[0].versionId, '')
  const board = ui.whiteboardTaskBoardSchema.parse(fixture)
  assert.equal(board.deliveries[1].result.artifacts[0].versionId, 'prd-v1')
  assert.equal(board.result.artifacts[0].versionId, 'prd-v2')
  assert.equal(board.result.artifacts.find(a => a.id === 'api').versionId, 'api-v1')
  const html = renderToStaticMarkup(createElement(Workspace, { board, result: board.result }))
  assert(!html.includes('交付轮次'))
  assert(!html.includes('历史交付 ·'))
})

test('history validates uniqueness, bounds, exact snapshots and version identifiers', () => {
  const bad = []
  const duplicate = structuredClone(fixture); duplicate.deliveries.push(duplicate.deliveries[1]); bad.push(duplicate)
  const sequence = structuredClone(fixture); sequence.deliveries[2].sequence = 2; bad.push(sequence)
  const unbound = structuredClone(fixture); delete unbound.deliveries[1].result.artifacts[0].versionId; bad.push(unbound)
  const changed = structuredClone(fixture); changed.deliveries[2].result.artifacts[0].content = '改写了同一个版本'; bad.push(changed)
  const wrongRun = structuredClone(fixture); wrongRun.deliveries[1].result.runId = 'other'; bad.push(wrongRun)
  for (const board of bad) assert.equal(ui.whiteboardTaskBoardSchema.safeParse(board).success, false)
  const remote = { id: 'remote', sequence: 4, createdAt: '2026-10-28T15:00:00+08:00', snapshotUrl: 'https://backend.example/deliveries/remote' }
  assert(ui.resultDeliverySchema.safeParse(remote).success)
  assert(!ui.resultDeliverySchema.safeParse({ ...remote, result: {} }).success)
  assert(!ui.resultDeliverySchema.safeParse({ ...remote, snapshotUrl: '' }).success)
  assert(!ui.whiteboardTaskBoardSchema.safeParse({ deliveries: Array.from({ length: 21 }, (_, n) => ({ ...remote, id: `d-${n}`, sequence: n + 1 })) }).success)
})

test('receiver rejects overwritten versions across snapshots and keeps the previous state intact', () => {
  const state = new OfficeState()
  state.apply([snapshot(fixture)])
  const changed = structuredClone(fixture)
  changed.deliveries = []
  changed.result.artifacts[0].content = 'same version, different body'
  assert.throws(() => state.apply([snapshot(changed, 2)]), error => error.reasonCode === 'RESULT_HISTORY_CONFLICT')
  assert.equal(state.get('history-demo').seq, 1)
  changed.result.artifacts[0].versionId = 'prd-v3'
  changed.result.artifacts[0].sha256 = hash(changed.result.artifacts[0].content)
  state.apply([snapshot(changed, 2)])
  assert.equal(state.get('history-demo').seq, 2)
})

test('receiver freezes delivered records while allowing unrelated conversation data', () => {
  const state = new OfficeState()
  state.apply([snapshot(fixture)])
  const changed = structuredClone(fixture)
  changed.deliveries[1].result.summary = '覆盖历史结论'
  assert.throws(() => state.apply([snapshot(changed, 2)]), error => error.reasonCode === 'RESULT_HISTORY_CONFLICT')
  state.apply([snapshot(changed, 2, 'different-conversation')])
  assert.equal(state.get('history-demo').seq, 2)
})

test('delivered task state, details and record identity cannot be rewritten', () => {
  const original = structuredClone(fixture)
  original.deliveries[1].board = { title: '历史任务', status: 'blocked', summary: '等待授权', steps: [{ id: 'approval', title: '审批', progress: 0 }] }
  const mutations = [
    delivery => { delivery.board.status = 'completed' },
    delivery => { delivery.board.summary = '已经授权' },
    delivery => { delivery.board.steps[0].progress = 100 },
    delivery => { delivery.board.detailSections = [{ id: 'changed', title: '改写详情', blocks: [{ type: 'text', text: '已完成' }] }] },
    delivery => { delete delivery.board },
    delivery => { delivery.title = '改写交付标题' },
    delivery => { delete delivery.result; delivery.snapshotUrl = 'https://example.com/replacement' },
  ]
  for (const mutate of mutations) {
    const state = new OfficeState()
    state.apply([snapshot(original)])
    const changed = structuredClone(original)
    mutate(changed.deliveries[1])
    assert.throws(() => state.apply([snapshot(changed, 2)]), error => error.reasonCode === 'RESULT_HISTORY_CONFLICT')
    assert.deepEqual(state.get('history-demo'), snapshot(original), 'rejected update leaves history intact')
    const currentOnly = structuredClone(original)
    currentOnly.status = 'completed'
    state.apply([snapshot(currentOnly, 2)])
    assert.equal(state.get('history-demo').conversations[0].whiteboard.status, 'completed')
  }
})

test('checks for an old artifact version are displayed as pending without changing backend data', () => {
  const board = ui.whiteboardTaskBoardSchema.parse(fixture)
  const checks = presentation.resultChecks(board.result)
  assert.equal(checks[0].status, 'pending')
  assert.equal(checks[0].stale, true)
  assert.equal(board.result.checks[0].status, 'passed')
  assert.equal(presentation.resultChecks(board.deliveries[1].result)[0].status, 'passed')
  assert(presentation.resultAttention(board.result).some(item => item.title.includes('重新验证')))
  const report = format.resultReport(board.result)
  assert(report.includes('- [ ] 需求范围检查（验证版本已更新，需重新验证）'))
  assert(!report.includes('- [x] 需求范围检查'))
  assert(report.includes('版本：v2.0（prd-v2）'))
  assert(!ui.resultCheckSchema.safeParse({ id: 'c', label: '不完整绑定', artifactId: 'doc' }).success)
})

test('preview verifies exact inline content and never substitutes a different version', async t => {
  const artifact = ui.resultArtifactSchema.parse({ id: 'doc', title: '版本', versionId: 'v1', content: '旧版内容', sha256: hash('旧版内容') })
  assert.equal(new TextDecoder().decode(await resources.readArtifactVersion(artifact, new AbortController().signal)), '旧版内容')
  await assert.rejects(resources.readArtifactVersion({ ...artifact, content: '新版内容' }, new AbortController().signal), /校验失败/)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return new Response('missing', { status: 404 }) })
  await assert.rejects(resources.readArtifactVersion({ ...artifact, content: '', url: 'https://backend.example/versions/v1' }, new AbortController().signal), /历史版本已不可用/)
  assert.deepEqual(calls.map(call => call.url), ['https://backend.example/versions/v1'])
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.headers, undefined)
})

test('external history must match the requested delivery id and sequence', async t => {
  const record = ui.resultDeliverySchema.parse({ id: 'delivery-2', sequence: 2, createdAt: fixture.deliveries[1].createdAt, snapshotUrl: 'https://backend.example/history/2' })
  t.mock.method(globalThis, 'fetch', async () => Response.json(fixture.deliveries[1]))
  const resolved = await resources.readDeliverySnapshot(record, new AbortController().signal)
  assert.equal(resolved.result.artifacts[0].versionId, 'prd-v1')
  globalThis.fetch.mock.mockImplementation(async () => Response.json(fixture.deliveries[2]))
  await assert.rejects(resources.readDeliverySnapshot(record, new AbortController().signal), /轮次不匹配/)
})

test('version comparison preserves old/new lines and bounds expensive comparisons', () => {
  const result = diff.compareArtifactText('first\nold\nlast', 'first\nnew\nextra\nlast')
  assert.deepEqual(result.lines.filter(line => line.kind === 'deleted').map(line => [line.oldLine, line.text]), [[2, 'old']])
  assert.deepEqual(result.lines.filter(line => line.kind === 'added').map(line => [line.newLine, line.text]), [[2, 'new'], [3, 'extra']])
  assert.equal(diff.compareArtifactText('same', 'same').lines.length, 0)
  assert.equal(diff.compareArtifactText('x'.repeat(200001), '').tooLarge, true)
  const large = diff.compareArtifactText(Array.from({ length: 1000 }, (_, n) => `a${n}`).join('\n'), Array.from({ length: 1000 }, (_, n) => `b${n}`).join('\n'))
  assert.equal(large.coarse, true)
  assert.equal(large.lines.length, 240)
  assert.equal(large.truncated, true)
})
