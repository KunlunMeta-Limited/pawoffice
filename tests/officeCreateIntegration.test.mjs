import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPawOfficeServer, DEMO_API_KEY } from '../server/dist/app.js'
import { officeSnapshotSchema, officeUiActionSchema } from '@pawoffice/protocol/office-integration'

const snapshot = id => ({ schemaVersion: '1.0', seq: 1, workspace: { id, name: '我的办公室' }, conversations: [{ id: 'main', title: '主会话' }] })
const action = id => ({ id, teamId: '', conversationId: '', action: 'office.create', name: '我的办公室' })
const post = (app, payload) => app.inject({ method: 'POST', url: '/api/pawoffice/messages', headers: { authorization: `Bearer ${DEMO_API_KEY}` }, payload })
const create = (app, id) => app.inject({ method: 'POST', url: '/api/pawoffice/ui', payload: action(id) }).then(value => value)
async function setup(t) { const app = await createPawOfficeServer(); t.after(() => app.close()); return app }

test('the first office can be requested from the browser before initialization and is cached only after backend confirmation', async t => {
  const app = await setup(t)
  let settled = false
  const pending = create(app, 'first-office').then(response => { settled = true; return response })
  const next = await post(app, { type: 'ui.next', timeoutMs: 1000 })
  assert.deepEqual(next.json().data.actions, [action('first-office')])
  assert.equal(settled, false)
  assert.deepEqual((await post(app, { type: 'office.read' })).json().data.offices, [])
  const normalized = officeSnapshotSchema.parse(snapshot('host-assigned-id'))
  const confirmed = await post(app, { type: 'ui.respond', interactionId: 'first-office', presentation: { target: 'office', snapshot: normalized } })
  assert.equal(confirmed.statusCode, 200)
  const result = await pending
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.json().data, { target: 'office', snapshot: normalized })
  assert.equal((await post(app, { type: 'office.read' })).json().data.offices[0].id, 'host-assigned-id')
})

test('backend creation failures preserve the empty directory and allow a new request', async t => {
  const app = await setup(t)
  const pending = create(app, 'failed-office')
  await post(app, { type: 'ui.next', timeoutMs: 1000 })
  const invalid = await post(app, { type: 'ui.respond', interactionId: 'failed-office', presentation: { target: 'result', success: true } })
  assert.equal(invalid.statusCode, 400, 'success must include an actual office snapshot')
  await post(app, { type: 'ui.respond', interactionId: 'failed-office', presentation: { target: 'result', success: false, message: '目录不可写' } })
  assert.equal((await pending).json().data.message, '目录不可写')
  assert.deepEqual((await post(app, { type: 'office.read' })).json().data.offices, [])
  const retry = create(app, 'retried-office')
  await post(app, { type: 'ui.next', timeoutMs: 1000 })
  await post(app, { type: 'ui.respond', interactionId: 'retried-office', presentation: { target: 'office', snapshot: snapshot('new-id') } })
  assert.equal((await retry).statusCode, 200)
})

test('creation cannot overwrite an existing office and validates unscoped identities and same-origin requests', async t => {
  const app = await setup(t)
  await post(app, { type: 'offices.initialize', offices: [snapshot('existing')] })
  assert.equal(officeUiActionSchema.safeParse({ ...action('wrong-scope'), teamId: 'existing' }).success, false)
  assert.equal(officeUiActionSchema.safeParse({ ...action('blank-name'), name: ' ' }).success, false)
  const crossSite = await app.inject({ method: 'POST', url: '/api/pawoffice/ui', headers: { origin: 'https://other.example', 'sec-fetch-site': 'cross-site' }, payload: action('cross-site') })
  assert.equal(crossSite.statusCode, 403)
  const pending = create(app, 'duplicate-office')
  await post(app, { type: 'ui.next', timeoutMs: 1000 })
  const duplicate = await post(app, { type: 'ui.respond', interactionId: 'duplicate-office', presentation: { target: 'office', snapshot: snapshot('existing') } })
  assert.equal(duplicate.statusCode, 409)
  await post(app, { type: 'ui.respond', interactionId: 'duplicate-office', presentation: { target: 'result', success: false, message: '办公室已存在' } })
  assert.equal((await pending).json().data.success, false)
})
