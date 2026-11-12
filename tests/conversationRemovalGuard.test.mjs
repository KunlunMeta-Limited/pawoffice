import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'

/**
 * ChatWorkspace may refuse deleting a conversation (used while a local demo is running in it).
 * The guard is optional and must not change the default delete behaviour.
 */

let server, ChatWorkspace
before(async () => {
  server = await createTestServer()
  ;({ ChatWorkspace } = await server.ssrLoadModule('/apps/web/src/chat/ChatWorkspace.ts'))
})
after(() => server?.close())

const fakeSource = () => ({ kind: 'preview', stream: async function* () {} })
const conversation = (id, title) => ({ id, title, employees: [], tasks: [], events: [], whiteboard: {} })

test('拒绝删除受保护的会话，并保留会话与提示原因', async () => {
  const workspace = new ChatWorkspace('office-analysis', fakeSource(), {
    canRemove: id => id === 'main' ? '该会话正在执行任务，请先停止演示再删除。' : undefined,
  })
  await workspace.ready
  workspace.sync([conversation('main', '折叠电脑支架上架准备')])
  assert(workspace.getSnapshot().conversations.some(entry => entry.id === 'main'))

  await assert.rejects(workspace.remove('main'), /请先停止演示再删除/)
  assert(workspace.getSnapshot().conversations.some(entry => entry.id === 'main'), '被拒绝的会话必须保留')
  assert.equal(workspace.getSnapshot().deletingIds.length, 0, '被拒绝的删除不应进入删除中状态')
})

test('未被守卫拦截的会话仍可正常删除（默认行为不变）', async () => {
  const workspace = new ChatWorkspace('office-analysis', fakeSource(), {
    canRemove: id => id === 'main' ? '该会话正在执行任务，请先停止演示再删除。' : undefined,
  })
  await workspace.ready
  workspace.sync([conversation('main', '主会话'), conversation('side', '临时会话')])
  assert.equal(workspace.getSnapshot().conversations.length, 2)

  await workspace.remove('side')
  assert.deepEqual(workspace.getSnapshot().conversations.map(entry => entry.id), ['main'])
})

test('没有 canRemove 时删除行为保持原样', async () => {
  const workspace = new ChatWorkspace('office-analysis', fakeSource())
  await workspace.ready
  workspace.sync([conversation('main', '主会话')])
  await workspace.remove('main')
  assert.equal(workspace.getSnapshot().conversations.length, 0)
})
