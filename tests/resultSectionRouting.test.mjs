import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'
import { createPawOfficeServer } from '../server/dist/app.js'

let server, schema, sections, checks, format
before(async () => {
  server = await createTestServer()
  ;({ officeResultSchema: schema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  sections = await server.ssrLoadModule('/apps/web/src/results/sections.ts')
  checks = await server.ssrLoadModule('/apps/web/src/results/checks.ts')
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
})
after(() => server?.close())
const custom = (id, extra = {}) => ({ kind: 'custom', id, title: id, blocks: [{ type: 'text', text: id }], ...extra })
const artifact = (id = 'doc', versionId = 'v1') => ({ id, versionId, title: id, content: '正文' })
const binding = { artifactId: 'doc', versionId: 'v1' }

test('legacy sections remain readable while deliverables contain only artifacts and changes', () => {
  const value = schema.parse({ sections: [custom('legacy'), { kind: 'gallery', id: 'images', title: '旧图库', items: [{ id: 'a', title: '图片' }] },
    { kind: 'tests', id: 'checks', title: '旧检查', checks: [{ id: 'check', label: '一致性', status: 'passed' }] },
    { kind: 'changes', id: 'diff', title: '文件变更', files: [{ path: 'a.ts' }] }] })
  const layout = sections.resultContentLayout(value)
  assert.deepEqual(layout.supplementary.map(item => item.id), ['legacy', 'images'])
  assert.equal(layout.changes.length, 1)
  assert.equal(layout.evidence.length, 0)
  assert.equal(checks.resultEvidenceChecks(value).length, 1)
})

test('purpose routes content and exact source metadata without business-specific templates', () => {
  const value = schema.parse({ artifacts: [artifact()], sections: [custom('analysis', { purpose: 'analysis', ...binding }),
    custom('proof', { purpose: 'evidence' }), custom('preview', { purpose: 'artifact-preview', ...binding })] })
  const layout = sections.resultContentLayout(value)
  assert.equal(layout.analysis[0].id, 'analysis')
  assert.equal(layout.evidence[0].id, 'proof')
  assert.equal(layout.previews[0].id, 'preview')
  assert.equal(layout.supplementary.length, 0)
})

test('explicit file previews reject missing, ambiguous and wrong-version references', () => {
  const bad = [
    custom('x', { purpose: 'artifact-preview' }),
    custom('x', { purpose: 'artifact-preview', artifactId: 'doc' }),
    custom('x', { purpose: 'artifact-preview', artifactId: 'missing', versionId: 'v1' }),
    custom('x', { purpose: 'artifact-preview', artifactId: 'doc', versionId: 'v2' }),
    custom('x', { purpose: 'unrecognized' }),
  ]
  for (const section of bad) assert.equal(schema.safeParse({ artifacts: [artifact()], sections: [section] }).success, false)
  assert.equal(schema.safeParse({ artifacts: [artifact(), artifact()], sections: [custom('x', { purpose: 'artifact-preview', ...binding })] }).success, false)
  assert.equal(schema.safeParse({ sections: [{ kind: 'tests', purpose: 'analysis', id: 'x', title: '检查' }] }).success, false)
  // A named/versioned structured report is valid even without a physical file URL.
  assert(schema.safeParse({ artifacts: [{ id: 'doc', versionId: 'v1', title: '结构化报告' }], sections: [custom('x', { purpose: 'artifact-preview', ...binding })] }).success)
})

test('duplicate acceptance checks appear once and conflicting or stale checks remain conservative', () => {
  const check = { id: 'check', label: '预算一致性', status: 'passed', ...binding }
  const value = schema.parse({ status: 'verified', artifacts: [artifact()], checks: [check], sections: [{ kind: 'tests', id: 'tests', title: '资料检查', checks: [check] }] })
  assert.equal(checks.resultEvidenceChecks(value).length, 1)
  assert.equal(format.resultReport(value).split('预算一致性').length - 1, 1)
  value.sections[0].checks[0].status = 'failed'
  assert.equal(checks.resultEvidenceChecks(value)[0].status, 'failed')
  assert.equal(checks.resultVerificationConflict(value), true)
  value.artifacts[0].versionId = 'v2'
  assert.equal(checks.resultEvidenceChecks(value)[0].status, 'pending')
})

test('artifact rich previews never borrow a different version or a same-title file', () => {
  const current = schema.parse({ artifacts: [artifact('doc', 'v2')], sections: [custom('new', { purpose: 'artifact-preview', artifactId: 'doc', versionId: 'v2' })] })
  const old = schema.parse({ artifacts: [artifact()], sections: [custom('old', { purpose: 'artifact-preview', ...binding })] })
  assert.equal(sections.artifactPreviewSections([current, old], old.artifacts[0])[0].id, 'old')
  assert.deepEqual(sections.artifactPreviewSections([current], old.artifacts[0]), [])
  assert.deepEqual(sections.artifactPreviewSections([old], { ...old.artifacts[0], id: 'other' }), [])
})

test('real receiver accepts old and new payloads, but rejects an invalid new preview', async () => {
  const app = await createPawOfficeServer()
  const office = { schemaVersion: '1.0', seq: 1, workspace: { id: 'routing', name: '内容归属' }, conversations: [{ id: 'main', title: '主会话', whiteboard: { result: { sections: [custom('legacy')] } } }] }
  const post = payload => app.inject({ method: 'POST', url: '/api/pawoffice/messages', headers: { authorization: 'Bearer pawoffice-demo-key' }, payload })
  try {
    assert.equal((await post({ type: 'offices.initialize', offices: [office] })).statusCode, 202)
    office.seq++
    office.conversations[0].whiteboard.result = { artifacts: [artifact()], sections: [custom('preview', { purpose: 'artifact-preview', ...binding })] }
    assert([200, 202].includes((await post({ type: 'office.snapshot', teamId: 'routing', snapshot: office })).statusCode))
    office.seq++
    office.conversations[0].whiteboard.result.sections[0].versionId = 'wrong'
    assert.equal((await post({ type: 'office.snapshot', teamId: 'routing', snapshot: office })).statusCode, 400)
  } finally { await app.close() }
})
