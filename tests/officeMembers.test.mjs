import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'
import { createPawOfficeServer, DEMO_API_KEY } from '../server/dist/app.js'
import { officeUiActionSchema } from '@pawoffice/protocol/office-integration'
import { maxOfficeMembers, officeMemberOccupancy } from '@pawoffice/protocol/dashboard'

let server, ExampleOfficeDataSource, OfficeTeamSession, createOfficeRuntime, AddOfficeMemberDialog
before(async () => {
  server = await createTestServer()
  ;({ ExampleOfficeDataSource } = await server.ssrLoadModule('/apps/web/src/dashboard/demoSource.ts'))
  ;({ OfficeTeamSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeTeamSession.ts'))
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ AddOfficeMemberDialog } = await server.ssrLoadModule('/apps/web/src/ui/AddOfficeMemberDialog.tsx'))
})
after(() => server?.close())

const member = { name: '运营助手', role: '商品运营', sceneActorId: 'code-agent' }

async function partialSource(count = 5) {
  const initial = await new ExampleOfficeDataSource().getSnapshot()
  const employees = initial.employees.filter(employee => employee.sceneActorId !== member.sceneActorId).slice(0, count)
  return new ExampleOfficeDataSource(new Date(), { tasks: [], employees })
}

test('member creation validates its fields and rejects null without changing other UI actions', () => {
  const action = { ...member, id: 'create-member', action: 'employee.create', teamId: 'team-a', conversationId: 'main' }
  assert.deepEqual(officeUiActionSchema.parse(action), action)
  assert.equal(officeUiActionSchema.parse({ ...action, role: undefined }).role, '')
  for (const field of ['name', 'role', 'sceneActorId']) assert.equal(officeUiActionSchema.safeParse({ ...action, [field]: null }).success, false)
  assert.equal(officeUiActionSchema.safeParse({ ...action, name: '   ' }).success, false)
  assert.equal(officeUiActionSchema.safeParse({ ...action, name: 'a'.repeat(81) }).success, false)
})

test('local member creation uses a vacant slot and stops at six without modifying existing members', async () => {
  const source = await partialSource()
  const before = await source.getSnapshot()
  let notifications = 0
  source.subscribe(() => { notifications++ })
  await source.createEmployee({ ...member, name: '  运营助手  ' })
  const added = await source.getSnapshot()
  assert.equal(added.employees.length, before.employees.length + 1)
  assert.equal(added.employees.at(-1).name, member.name)
  assert.equal(added.employees.at(-1).sceneActorId, member.sceneActorId)
  assert.equal(new Set(added.employees.map(employee => employee.id)).size, added.employees.length)
  assert.deepEqual(added.employees.slice(0, -1), before.employees)
  assert.equal(added.events[0].employeeId, added.employees.at(-1).id)
  assert.equal(notifications, 1)
  source.selectConversation('other-conversation')
  assert.equal((await source.getSnapshot()).employees.length, 0)
  source.selectConversation('main')
  assert.equal((await source.getSnapshot()).employees.length, maxOfficeMembers)
  await assert.rejects(source.createEmployee(member), /最多 6 位成员/)
  assert.equal((await source.getSnapshot()).employees.length, 6)
})

test('adding a member to an empty local conversation retains the new conversation data', async () => {
  const source = await partialSource()
  source.selectConversation('new-conversation')
  await source.createEmployee(member)
  assert.equal(source.getConversations().find(item => item.id === 'new-conversation').employees.length, 1)
  source.selectConversation('main'); source.selectConversation('new-conversation')
  assert.equal((await source.getSnapshot()).employees[0].name, member.name)
  source.selectConversation('another-conversation')
  await assert.rejects(source.createEmployee({ ...member, sceneActorId: 'file-agent' }), /最多 6 位成员/)
})

test('office-wide occupancy deduplicates the same member across conversations but reserves every used character', () => {
  const occupancy = officeMemberOccupancy([{ employees: [{ id: 'one', sceneActorId: 'office-lead' }] },
    { employees: [{ id: 'one', sceneActorId: 'office-lead' }, { id: 'two', sceneActorId: 'code-agent' }] }])
  assert.equal(occupancy.memberIds.size, 2)
  assert.deepEqual([...occupancy.actorIds], ['office-lead', 'code-agent'])
})

test('local creation rejects occupied and unknown slots even when fewer than six members exist', async () => {
  const source = await partialSource(3)
  await assert.rejects(source.createEmployee({ ...member, sceneActorId: 'office-lead' }), /已有成员/)
  await assert.rejects(source.createEmployee({ ...member, sceneActorId: 'missing' }), /人物不存在/)
  assert.equal((await source.getSnapshot()).employees.length, 3)
})

async function team(t, source, options = {}) {
  const runtime = createOfficeRuntime({ sceneId: 'team-a' })
  const session = new OfficeTeamSession(runtime, source, options)
  t.after(() => { session.stop(); runtime.dispose() })
  await session.start()
  return session
}

test('local team member creation refreshes roster data without changing scene actors or furniture', async t => {
  const session = await team(t, await partialSource())
  const actors = session.runtime.readActors(), props = session.runtime.readWorld().props
  assert.equal(session.canCreateEmployee, true)
  await session.createEmployee(member)
  assert.equal(session.getSnapshot().dashboard.employees.length, 6)
  assert.match(session.memberCreation.blockedReason, /最多 6 位成员/)
  assert.deepEqual(session.runtime.readActors().map(actor => [actor.id, actor.homeId, actor.templateId]), actors.map(actor => [actor.id, actor.homeId, actor.templateId]))
  assert.deepEqual(session.runtime.readWorld().props.map(prop => prop.id), props.map(prop => prop.id))
})

test('remote creation carries office and conversation scope and uses backend snapshot data', async t => {
  let snapshot = await (await partialSource()).getSnapshot()
  const actions = []
  const session = await team(t, { kind: 'push', subscribe: () => () => {}, getSnapshot: async () => snapshot, execute: async () => {} }, {
    requestUi: async action => {
      actions.push(action)
      snapshot = { ...snapshot, employees: [...snapshot.employees, { ...member, id: 'backend-id', online: false }] }
      return { target: 'result', success: true, message: '已添加' }
    },
  })
  await session.createEmployee(member)
  assert.deepEqual({ ...actions[0], id: '' }, { id: '', teamId: 'team-a', conversationId: 'main', action: 'employee.create', ...member })
  assert.equal(session.getSnapshot().dashboard.employees.at(-1).id, 'backend-id')
  assert.equal(session.getSnapshot().dashboard.employees.at(-1).online, false)
})

test('a rejected or duplicate remote creation never invents a local member and can be retried', async t => {
  const snapshot = await (await partialSource()).getSnapshot()
  let finish, calls = 0
  const session = await team(t, { kind: 'push', subscribe: () => () => {}, getSnapshot: async () => snapshot, execute: async () => {} }, {
    requestUi: () => { calls++; return new Promise(resolve => { finish = resolve }) },
  })
  const request = session.createEmployee(member)
  await assert.rejects(session.createEmployee(member), /正在添加/)
  assert.equal(calls, 1)
  finish({ target: 'result', success: false, message: '没有添加权限' })
  await assert.rejects(request, /没有添加权限/)
  assert.equal(session.getSnapshot().dashboard.employees.length, 5)
  const retry = session.createEmployee(member)
  finish({ target: 'result', success: false, message: '仍未授权' })
  await assert.rejects(retry, /仍未授权/)
  assert.equal(calls, 2)
})

test('a full team rejects member creation before invoking its source or external backend', async t => {
  const source = new ExampleOfficeDataSource()
  const create = t.mock.method(source, 'createEmployee')
  const session = await team(t, source)
  assert.match(session.memberCreation.blockedReason, /最多 6 位成员/)
  assert.deepEqual(session.memberCreation.availableActorIds, [])
  await assert.rejects(session.createEmployee(member), /最多 6 位成员/)
  assert.equal(create.mock.callCount(), 0)
})

test('the add member dialog exposes labelled fields and reuses existing character portraits', () => {
  const html = renderToStaticMarkup(createElement(AddOfficeMemberDialog, { actors: [{ id: 'code-agent', name: '李研' }],
    appearanceIds: { 'code-agent': 'app-agent' }, create: async () => {}, onClose() {} }))
  assert.match(html, /aria-label="成员姓名"/)
  assert.match(html, /aria-label="成员职责"/)
  assert.match(html, /role="radiogroup" aria-label="空闲工位"/)
  assert.match(html, /aria-label="选择李研的工位"[^>]* checked=""/)
  assert.match(html, /type="submit" class="office-member-submit" disabled=""/)
})

test('server member creation requires a genuinely new matching member snapshot before success', async t => {
  const app = await createPawOfficeServer()
  t.after(() => app.close())
  const post = payload => app.inject({ method: 'POST', url: '/api/pawoffice/messages', headers: { authorization: `Bearer ${DEMO_API_KEY}` }, payload })
  const state = { schemaVersion: '1.0', seq: 1, workspace: { id: 'team-a', name: '测试团队' }, conversations: [
    { id: 'main', title: '主会话', employees: [{ id: 'existing', ...member, sceneActorId: 'office-lead' }], tasks: [], events: [] },
  ] }
  await post({ type: 'offices.initialize', offices: [state] })
  const action = { id: 'add-member', action: 'employee.create', teamId: 'team-a', conversationId: 'main', ...member }
  const browser = app.inject({ method: 'POST', url: '/api/pawoffice/ui', payload: action }).then(value => value)
  assert.deepEqual((await post({ type: 'ui.next', timeoutMs: 1000 })).json().data.actions, [action])
  const success = { type: 'ui.respond', interactionId: action.id, presentation: { target: 'result', success: true, message: '已添加' } }
  assert.equal((await post(success)).json().data.reasonCode, 'SNAPSHOT_REQUIRED', 'an existing identical name is not proof of creation')
  state.seq++; state.conversations[0].employees.push({ id: 'new-id', ...member })
  assert.equal((await post({ type: 'office.snapshot', teamId: 'team-a', snapshot: state })).statusCode, 202)
  assert.equal((await post(success)).statusCode, 200)
  assert.deepEqual((await browser).json().data, success.presentation)
  const invalid = await app.inject({ method: 'POST', url: '/api/pawoffice/ui', payload: { ...action, id: 'bad-binding', sceneActorId: 'unknown' } })
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.json().data.reasonCode, 'INVALID_BINDING')
})

test('server reserves the final member slot across pages and releases it after rejection', async t => {
  const app = await createPawOfficeServer()
  t.after(() => app.close())
  const post = payload => app.inject({ method: 'POST', url: '/api/pawoffice/messages', headers: { authorization: `Bearer ${DEMO_API_KEY}` }, payload })
  const state = { schemaVersion: '1.0', seq: 1, workspace: { id: 'team-a', name: '测试团队' }, conversations: [
    { id: 'main', title: '主会话', employees: Array.from({ length: 5 }, (_, index) => ({ id: `member-${index}`, name: `成员${index}`, sceneActorId: '' })), tasks: [], events: [] },
    { id: 'empty', title: '空会话', employees: [], tasks: [], events: [] },
  ] }
  await post({ type: 'offices.initialize', offices: [state] })
  const request = (id, sceneActorId = 'code-agent', conversationId = 'main') => app.inject({ method: 'POST', url: '/api/pawoffice/ui',
    payload: { id, action: 'employee.create', teamId: 'team-a', conversationId, ...member, sceneActorId } }).then(value => value)
  const first = request('reserve-one')
  await post({ type: 'ui.next', timeoutMs: 1000 })
  const blocked = await request('reserve-two', 'app-agent', 'empty')
  assert.equal(blocked.statusCode, 409)
  assert.equal(blocked.json().data.reasonCode, 'OFFICE_LIMIT')
  await post({ type: 'ui.respond', interactionId: 'reserve-one', presentation: { target: 'result', success: false, message: '取消添加' } })
  assert.equal((await first).json().data.success, false)
  const retry = request('reserve-retry', 'app-agent', 'empty')
  assert.equal((await post({ type: 'ui.next', timeoutMs: 1000 })).json().data.actions[0].id, 'reserve-retry')
  await post({ type: 'ui.respond', interactionId: 'reserve-retry', presentation: { target: 'result', success: false, message: '取消添加' } })
  await retry
  state.seq++; state.conversations[0].employees.push({ id: 'sixth', name: '第六位', sceneActorId: 'data-agent' })
  await post({ type: 'office.snapshot', teamId: 'team-a', snapshot: state })
  const full = await request('seventh', 'code-agent', 'empty')
  assert.equal(full.statusCode, 409)
  assert.equal(full.json().data.reasonCode, 'OFFICE_LIMIT')
})

test('server rejects a slot already occupied in a different conversation', async t => {
  const app = await createPawOfficeServer()
  t.after(() => app.close())
  await app.inject({ method: 'POST', url: '/api/pawoffice/messages', headers: { authorization: `Bearer ${DEMO_API_KEY}` }, payload: {
    type: 'offices.initialize', offices: [{ schemaVersion: '1.0', seq: 1, workspace: { id: 'team-a', name: '测试团队' }, conversations: [
      { id: 'main', title: '主会话', employees: [{ id: 'existing', ...member }], tasks: [], events: [] },
      { id: 'empty', title: '空会话', employees: [], tasks: [], events: [] },
    ] }],
  } })
  const result = await app.inject({ method: 'POST', url: '/api/pawoffice/ui', payload: { id: 'occupied', action: 'employee.create', teamId: 'team-a', conversationId: 'empty', ...member } })
  assert.equal(result.statusCode, 409)
  assert.equal(result.json().data.reasonCode, 'INVALID_BINDING')
})
