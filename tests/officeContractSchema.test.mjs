import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { maxDecisionCustomText, officeDecisionResultSchema, officeErrorResultSchema, officeMessageSchema, officeSnapshotSchema } from '@pawoffice/protocol/office-integration'
import { createPawOfficeServer, DEMO_API_KEY } from '../server/dist/app.js'

const require = createRequire(import.meta.url)
const Ajv = createRequire(require.resolve('@fastify/ajv-compiler'))('ajv/dist/2020.js').default
const validator = () => new Ajv({ strict: false, validateFormats: false, allErrors: true, logger: false })
const minimal = () => ({ schemaVersion: '1.0', seq: 1, workspace: { id: 'schema-office', name: '契约检查' } })
async function capabilities(t) {
  const app = await createPawOfficeServer(); t.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/pawoffice/messages', headers: { authorization: `Bearer ${DEMO_API_KEY}` }, payload: { type: 'office.capabilities' } })
  assert.equal(response.statusCode, 200)
  return response.json().data
}

test('published request schemas accept omitted defaults and explicit empty references without weakening required identities', async t => {
  const data = await capabilities(t), validate = validator().compile(data.requests)
  const sparse = { ...minimal(), conversations: [{ id: 'main', title: '主会话', employees: [{ id: 'dev', name: '开发' }], tasks: [{ id: 'task', title: '待分配任务', status: 'queued', updatedAt: '2026-10-18T10:00:00Z' }], events: [{ id: 'note', kind: 'note', summary: '项目动态', occurredAt: '2026-10-18T10:00:00Z' }] }] }
  for (const request of [
    { type: 'office.read' }, { type: 'office.read', teamId: '' }, { type: 'ui.next' }, { type: 'office.capabilities' },
    { type: 'offices.initialize', offices: [sparse] },
    { type: 'offices.initialize', offices: [], chat: { url: 'https://backend.example/chat' } },
    { type: 'offices.initialize', offices: [], chat: { url: '' } },
    { type: 'office.snapshot', teamId: 'schema-office', snapshot: officeSnapshotSchema.parse(sparse) },
    { conversationId: 'main', type: 'decision.request', teamId: 'schema-office', decision: { id: 'menu', kind: 'confirmation', title: '是否继续？' } },
    { type: 'ui.respond', interactionId: 'inspect', presentation: { target: 'dialog', content: { template: 'detail-v1', title: '详情' } } },
    { type: 'ui.respond', interactionId: 'inspect', presentation: { target: 'whiteboard', snapshot: minimal() } },
    { type: 'ui.respond', interactionId: 'delete', presentation: { target: 'result', success: true, message: '会话已删除' } },
  ]) {
    assert(officeMessageSchema.safeParse(request).success)
    assert(validate(request), JSON.stringify({ request, errors: validate.errors }))
  }
  for (const request of [
    { type: 'office.read', teamId: null },
    { type: 'offices.initialize', offices: [], chat: null },
    { type: 'offices.initialize', offices: [], chat: { url: null } },
    { type: 'offices.initialize', offices: [{ ...minimal(), workspace: { id: '', name: '无效' } }] },
    { type: 'offices.initialize', offices: [{ ...minimal(), conversations: [{ id: 'main', title: '主会话', employees: [{ id: '', name: '无效' }] }] }] },
    { type: 'offices.initialize', offices: [{ ...sparse, conversations: [{ ...sparse.conversations[0], tasks: [{ ...sparse.conversations[0].tasks[0], id: '' }] }] }] },
    { type: 'offices.initialize', offices: [{ ...sparse, conversations: [{ ...sparse.conversations[0], employees: [{ id: 'dev', name: '开发', sceneActorId: null }] }] }] },
  ]) {
    assert.equal(officeMessageSchema.safeParse(request).success, false)
    assert.equal(validate(request), false)
  }
})

test('published UI and scene inputs accept default omission while response schemas require normalized output', async t => {
  const data = await capabilities(t), ajv = validator()
  const presentation = ajv.compile(data.ui.presentationSchema), board = ajv.compile(data.ui.whiteboardSchema)
  assert(presentation({ target: 'dialog', content: { template: 'detail-v1', title: '详情' } }))
  assert(board({ title: '开发计划', steps: [{ id: 'develop', title: '开发' }] }))
  assert.equal(board({ title: null }), false)
  const say = ajv.compile(data.scene.capabilities.find(item => item.id === 'scene.say').params)
  assert(say({ text: '开始处理' }))
  const boardState = ajv.compile(data.scene.objects.find(item => item.id === 'whiteboard-1').stateSchema)
  assert(boardState({}))
  const error = ajv.compile(data.responses.error)
  assert(error(officeErrorResultSchema.parse({ reasonCode: 'INVALID_MESSAGE' })))
  assert.equal(error({ reasonCode: 'INVALID_MESSAGE' }), false, 'response defaults must still be present on the wire')
  const success = ajv.compile(data.responses.success)
  assert(success({ actions: [] }))
})

test('choice requests default allowCustom true, always reserve custom and keep customText optional', async t => {
  const data = await capabilities(t), validate = validator().compile(data.requests)
  const request = { conversationId: 'main', type: 'decision.request', teamId: 'schema-office',
    decision: { id: 'menu', kind: 'choice', title: '选择', options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }] } }
  const parsed = officeMessageSchema.parse(request)
  assert.equal(parsed.decision.allowCustom, true)
  assert(validate(request))
  for (const allowCustom of [true, false]) {
    const explicit = { ...request, decision: { ...request.decision, allowCustom } }
    assert.equal(officeMessageSchema.parse(explicit).decision.allowCustom, allowCustom)
    assert(validate(explicit))
  }
  for (const allowCustom of [undefined, true, false]) {
    const reserved = { ...request, decision: { ...request.decision, ...(allowCustom === undefined ? {} : { allowCustom }),
      options: [{ id: 'custom', label: '保留选项' }, { id: 'b', label: '乙' }] } }
    assert.equal(officeMessageSchema.safeParse(reserved).success, false, `custom is reserved with allowCustom=${allowCustom}`)
    assert.equal(validate(reserved), false, 'published JSON schema must reject the same reserved option id')
  }
  const ordinary = { ...request, decision: { ...request.decision, options: [{ id: 'custom-plan', label: '自定义方案' }, { id: 'b', label: '乙' }] } }
  assert(officeMessageSchema.safeParse(ordinary).success)
  assert(validate(ordinary))
  const customResult = officeDecisionResultSchema.parse({ teamId: 'schema-office', conversationId: 'main', decisionId: 'menu', choiceId: 'custom', label: '其他', customText: '  需要导出  ' })
  assert.equal(customResult.customText, '需要导出')
  assert.equal(officeDecisionResultSchema.safeParse({ ...customResult, customText: undefined }).success, true, 'customText must stay optional for existing callers')
  assert.equal(officeDecisionResultSchema.safeParse({ ...customResult, customText: '   ' }).success, false)
  assert.equal(officeDecisionResultSchema.safeParse({ ...customResult, customText: 'x'.repeat(maxDecisionCustomText + 1) }).success, false)
})
