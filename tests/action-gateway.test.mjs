// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import { appendFile, mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  applyActionState,
  createGatewayServer,
  createOfficeConversation,
  createTask,
  filterOfficeConversationMessages,
  filterOfficeConversationEvent,
  engineHostOrigin,
  listOfficeSessions,
  listAgentWorkspaces,
  listAgents,
  listConversationArtifacts,
  listFiles,
  listSessions,
  listSkills,
  listTasks,
  readWorkspaceFile,
  resolveWorkspaceProjectionStatePath,
  normalizeActions,
  mergeOfficeConversationTurns,
  parseFrontmatter,
  resetGatewayState,
  startPersistedTaskRecovery,
  turnHasAssistantText,
  validateAction,
} from '../scripts/action-gateway.mjs'

// Fetch 按标准拒绝访问部分历史服务端口；Windows 的随机端口分配可能命中这些端口。
const FETCH_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
])

async function listenOnFetchSafePort(server) {
  for (;;) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务未开放 TCP 端口')
    if (!FETCH_FORBIDDEN_PORTS.has(address.port)) return address
    await new Promise((resolve) => server.close(resolve))
  }
}

describe('动作网关契约', () => {
  beforeEach(async () => { await resetGatewayState() })

  it('未配置环境变量时默认连接本机 4096 Host', () => {
    const previous = process.env.OPENPAW_ENGINE_HOST_URL
    try {
      delete process.env.OPENPAW_ENGINE_HOST_URL
      expect(engineHostOrigin()).toBe('http://127.0.0.1:4096')
    } finally {
      if (previous === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previous
    }
  })

  it('事件流代理只保留 assistant 文本和会话状态', async () => {
    const engine = createServer((req, res) => {
      if (req.url !== '/global/event') { res.statusCode = 404; res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const events = [
        { type: 'message.updated', properties: { info: { id: 'm1', sessionID: 's1', role: 'assistant', time: { created: 1 } } } },
        { type: 'message.part.updated', properties: { part: { id: 'reasoning', messageID: 'm1', sessionID: 's1', type: 'reasoning', text: '' } } },
        { type: 'message.part.delta', properties: { partID: 'reasoning', messageID: 'm1', sessionID: 's1', field: 'text', delta: '内部推理' } },
        { type: 'message.part.updated', properties: { part: { id: 'text', messageID: 'm1', sessionID: 's1', type: 'text', text: '' } } },
        { type: 'message.part.delta', properties: { partID: 'text', messageID: 'm1', sessionID: 's1', field: 'text', delta: '可见回答' } },
        { type: 'session.idle', properties: { sessionID: 's1' } },
      ]
      events.forEach((event) => res.write(`data: ${JSON.stringify(event)}\n\n`))
      res.end()
    })
    const engineAddress = await listenOnFetchSafePort(engine)
    const previous = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    const gateway = createGatewayServer()
    try {
      const gatewayAddress = await listenOnFetchSafePort(gateway)
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/events`)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const text = await response.text()
      expect(text).toContain('可见回答')
      expect(text).toContain('session.idle')
      expect(text).not.toContain('内部推理')
      expect(text).not.toContain('reasoning')
    } finally {
      await new Promise((resolve) => gateway.close(resolve))
      await new Promise((resolve) => engine.close(resolve))
      if (previous === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previous
    }
  })

  it('事件白名单要求文本 part 先声明再接收增量', () => {
    const parts = new Set()
    expect(filterOfficeConversationEvent({ type: 'message.part.delta', properties: { partID: 'p1', messageID: 'm1', sessionID: 's1', field: 'text', delta: 'x' } }, parts)).toBeNull()
    expect(filterOfficeConversationEvent({ type: 'message.part.updated', properties: { part: { id: 'p1', messageID: 'm1', sessionID: 's1', type: 'text', text: '' } } }, parts)).not.toBeNull()
    expect(filterOfficeConversationEvent({ type: 'message.part.delta', properties: { partID: 'p1', messageID: 'm1', sessionID: 's1', field: 'text', delta: 'x' } }, parts)).toMatchObject({ properties: { delta: 'x' } })
  })

  it('子空间模型增量合并为一条输出并由最终正文闭合', async () => {
    const server = createGatewayServer()
    await listenOnFetchSafePort(server)
    const address = server.address()
    const origin = `http://127.0.0.1:${String(address.port)}`
    const base = { workspaceId: 's1:agent:1', workspaceName: '研究 Agent', parentWorkspaceId: 's1', sessionId: 's1' }
    try {
      for (const action of [
        { type: 'workspace_output', kind: 'model_delta', text: '第一段', ...base },
        { type: 'workspace_output', kind: 'model_delta', text: '第二段', ...base },
        { type: 'workspace_output', kind: 'model_final', text: '第一段第二段最终结论', ...base },
      ]) {
        const response = await fetch(`${origin}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
        expect(response.status).toBe(202)
      }
      const workspaces = await (await fetch(`${origin}/office/workspaces?sessionId=s1`)).json()
      const child = workspaces.find((workspace) => workspace.id === 's1:agent:1')
      expect(child.outputs.filter((output) => output.kind === 'model')).toEqual([
        expect.objectContaining({ text: '第一段第二段最终结论', streaming: false }),
      ])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('Gateway 创建时拒绝无效的 OpenPaw 引擎 origin', () => {
    const previous = process.env.OPENPAW_ENGINE_HOST_URL
    try {
      for (const invalid of [
        'not-a-url',
        'ftp://127.0.0.1:4096',
        'http://user:secret@127.0.0.1:4096',
        'http://127.0.0.1:4096/session',
        'http://127.0.0.1:4096?target=other',
        'http://127.0.0.1:4096#fragment',
      ]) {
        process.env.OPENPAW_ENGINE_HOST_URL = invalid
        expect(() => createGatewayServer()).toThrow('OPENPAW_ENGINE_HOST_URL 必须是')
      }
    } finally {
      if (previous === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previous
    }
  })

  it('以原子方式校验名册、状态和完整批次', () => {
    expect(validateAction({ type: 'desk_visit', visitor: 1, host: 2, message: '交接' })).toEqual({
      type: 'desk_visit', visitor: 1, host: 2, message: '交接',
    })
    expect(() => validateAction({ type: 'desk_visit', visitor: 1, host: 1, message: 'x' })).toThrow()
    expect(() => validateAction({ type: 'set_state', workspaceId: 'overview', rosterNo: 1, state: 'thinking' })).toThrow()
    expect(() => normalizeActions([{ type: 'set_state', rosterNo: 1, state: 'thinking' }, null])).toThrow()
    expect(normalizeActions({ actions: [{ type: 'set_state', rosterNo: 1, state: 'thinking', task: '审批' }] })).toHaveLength(1)
  })

  it('维护六名智能体的状态投影', () => {
    applyActionState({ type: 'set_state', rosterNo: 4, state: 'working', task: '撰写' })
    expect(listAgents()).toHaveLength(6)
    expect(listAgents()[3]).toMatchObject({ rosterNo: 4, id: 'app-agent', state: 'working', task: '撰写' })
    expect(listAgents()[0]).toMatchObject({ rosterNo: 1, state: 'idle', task: '' })
  })

  it('按真实 workspaceId 动态创建完整子 Agent 空间并隔离六人状态', () => {
    const action = validateAction({ type: 'set_state', workspaceId: 'research-agent', workspaceName: '旅行研究 Agent', parentWorkspaceId: 'main', sessionId: 'child-session', rosterNo: 2, state: 'working', task: '整理资料' })
    applyActionState(action)
    expect(listAgents()).toHaveLength(6)
    expect(listAgents()[1]).toMatchObject({ state: 'idle', task: '' })
    expect(listAgents('research-agent')[1]).toMatchObject({ name: '李研', state: 'working', task: '整理资料' })
    expect(listAgentWorkspaces()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main', kind: 'main', agents: expect.any(Array) }),
      expect.objectContaining({ id: 'research-agent', name: '旅行研究', kind: 'subagent', parentWorkspaceId: 'main', sessionId: 'child-session', agents: expect.any(Array) }),
    ]))
    expect(listAgentWorkspaces().find((workspace) => workspace.id === 'research-agent').agents).toHaveLength(6)
  })

  it('按空间保留脱敏输出记录，去重重复状态且角色回到空闲后记录仍可查看', () => {
    const metadata = { workspaceId: 'output-agent', workspaceName: '输出 Agent', parentWorkspaceId: 'session-output', sessionId: 'session-output' }
    applyActionState(validateAction({ type: 'set_state', ...metadata, rosterNo: 2, state: 'working', task: '正在汇总公开数据' }))
    applyActionState(validateAction({ type: 'set_state', ...metadata, rosterNo: 2, state: 'working', task: '正在汇总公开数据' }))
    applyActionState(validateAction({ type: 'set_state', ...metadata, rosterNo: 2, state: 'idle' }))
    const workspace = listAgentWorkspaces('session-output').find((item) => item.id === 'output-agent')
    expect(workspace.outputs).toEqual([
      expect.objectContaining({ kind: 'activity', text: '正在汇总公开数据', rosterNo: 2, state: 'working' }),
    ])
    expect(workspace.agents[1]).toMatchObject({ state: 'idle', task: '' })
  })

  it('按 sessionId 隔离不同对话的空间数量、名称和角色状态', async () => {
    const server = createGatewayServer()
    await listenOnFetchSafePort(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
    const origin = `http://127.0.0.1:${String(address.port)}`
    const post = (data) => fetch(`${origin}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    try {
      expect((await post([
        { type: 'set_state', workspaceId: 'session-a', workspaceName: '我的空间', sessionId: 'session-a', rosterNo: 1, state: 'thinking', task: '处理对话 A' },
        { type: 'set_state', workspaceId: 'session-a-research', workspaceName: '研究 Agent', parentWorkspaceId: 'session-a', sessionId: 'session-a', rosterNo: 2, state: 'working', task: '检索资料' },
        { type: 'set_state', workspaceId: 'session-b', workspaceName: '我的空间', sessionId: 'session-b', rosterNo: 1, state: 'idle' },
        { type: 'set_state', workspaceId: 'session-b-writer', workspaceName: '撰写 Agent', parentWorkspaceId: 'session-b', sessionId: 'session-b', rosterNo: 4, state: 'working', task: '整理文档' },
        { type: 'set_state', workspaceId: 'session-b-review', workspaceName: '审核 Agent', parentWorkspaceId: 'session-b', sessionId: 'session-b', rosterNo: 6, state: 'working', task: '审核结果' },
      ])).status).toBe(202)

      const sessionAResponse = await fetch(`${origin}/office/workspaces?sessionId=session-a`)
      const sessionBResponse = await fetch(`${origin}/office/workspaces?sessionId=session-b`)
      expect(sessionAResponse.status).toBe(200)
      expect(sessionBResponse.status).toBe(200)
      const sessionA = await sessionAResponse.json()
      const sessionB = await sessionBResponse.json()
      expect(sessionA.map((workspace) => workspace.id)).toEqual(['session-a', 'session-a-research'])
      expect(sessionB.map((workspace) => workspace.id)).toEqual(['session-b', 'session-b-review', 'session-b-writer'])
      expect(sessionA.some((workspace) => workspace.id.startsWith('session-b'))).toBe(false)
      expect(sessionB.some((workspace) => workspace.id.startsWith('session-a'))).toBe(false)
      expect(sessionA.find((workspace) => workspace.id === 'session-a-research').agents[1]).toMatchObject({ state: 'working', task: '检索资料' })
      expect(sessionB.find((workspace) => workspace.id === 'session-b-review').agents[5]).toMatchObject({ state: 'working', task: '审核结果' })

      await fetch(`${origin}/actions`)
      const rejectedBatch = await post([
        { type: 'set_state', workspaceId: 'session-a-research', sessionId: 'session-a', rosterNo: 2, state: 'idle', task: '不应提交' },
        { type: 'workspace_handoff', sessionId: 'session-a', fromWorkspaceId: 'session-a', toWorkspaceId: 'session-b', phase: 'going', message: '非法跨会话交接' },
      ])
      expect(rejectedBatch.status).toBe(400)
      const afterRejected = await (await fetch(`${origin}/office/workspaces?sessionId=session-a`)).json()
      expect(afterRejected.find((workspace) => workspace.id === 'session-a-research').agents[1]).toMatchObject({ state: 'working', task: '检索资料' })
      expect((await (await fetch(`${origin}/actions`)).json()).actions).toEqual([])
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('未知空间的完成动作不创建空间，删除会话后迟到动作被忽略', async () => {
    const engine = createServer((req, res) => {
      if (req.method === 'DELETE' && req.url === '/session/deleted-session') { res.statusCode = 204; res.end(); return }
      res.statusCode = 404; res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    const origin = `http://127.0.0.1:${String(gatewayAddress.port)}`
    const post = (data) => fetch(`${origin}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    try {
      const unknownComplete = await post({ type: 'workspace_handoff', sessionId: 'ghost-session', fromWorkspaceId: 'ghost-session', toWorkspaceId: 'ghost-child', phase: 'complete' })
      expect(unknownComplete.status).toBe(202)
      expect((await (await fetch(`${origin}/office/workspaces`)).json()).some((workspace) => workspace.sessionId === 'ghost-session')).toBe(false)

      expect((await post({ type: 'set_state', workspaceId: 'deleted-session', sessionId: 'deleted-session', rosterNo: 1, state: 'thinking', task: '即将删除' })).status).toBe(202)
      const deleted = await fetch(`${origin}/office/conversations/deleted-session`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      expect((await (await fetch(`${origin}/actions`)).json()).actions.some((action) => action.sessionId === 'deleted-session')).toBe(false)
      expect((await (await fetch(`${origin}/actions?after=0`)).json()).actions.some((action) => action.sessionId === 'deleted-session')).toBe(false)

      const late = await post({ type: 'set_state', workspaceId: 'deleted-session-child', parentWorkspaceId: 'deleted-session', sessionId: 'deleted-session', rosterNo: 2, state: 'working', task: '迟到动作' })
      expect(late.status).toBe(202)
      expect(await late.json()).toMatchObject({ accepted: 0, ignored: 1 })
      expect(await (await fetch(`${origin}/office/workspaces?sessionId=deleted-session`)).json()).toEqual([])
      expect((await (await fetch(`${origin}/office/workspaces`)).json()).some((workspace) => workspace.sessionId === 'deleted-session')).toBe(false)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('Gateway 重启后从 AI Office 状态目录恢复会话隔离的空间、交接和子 Agent 产物', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-workspace-state-'))
    const stateDirectory = path.join(root, 'office-state')
    const home = path.join(root, 'openpaw-home')
    const workspace = path.join(root, 'workspace')
    await mkdir(path.join(home, 'sessions'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(path.join(workspace, 'parent.md'), '# 父会话产物')
    await writeFile(path.join(workspace, 'child-a.md'), '# 子 Agent A')
    await writeFile(path.join(workspace, 'child-final.md'), '# 子 Agent 最终交付')
    await writeFile(path.join(workspace, 'child-b.md'), '# 子 Agent B')
    await writeFile(path.join(home, 'sessions', 'session-a.jsonl'), [
      { type: 'message', role: 'user', turnID: 'turn-parent', content: [{ type: 'text', text: '生成父会话交付物' }] },
      { type: 'message', role: 'assistant', turnID: 'turn-parent', content: [{ type: 'tool_use', id: 'parent-write', name: 'write_file', input: { path: 'parent.md' } }] },
      { type: 'message', role: 'user', turnID: 'turn-parent', content: [{ type: 'tool_result', tool_use_id: 'parent-write', is_error: false }] },
      { type: 'message', role: 'assistant', turnID: 'turn-parent', content: [{ type: 'text', text: '最终交付：`parent.md`、`child-final.md`。' }] },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n')
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    const createPersistentServer = async () => {
      const server = createGatewayServer({ persistWorkspaceState: true, stateDirectory })
      await listenOnFetchSafePort(server)
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
      return { server, origin: `http://127.0.0.1:${String(address.port)}` }
    }
    let first
    let second
    try {
      first = await createPersistentServer()
      const posted = await fetch(`${first.origin}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([
          { type: 'set_state', workspaceId: 'session-a', workspaceName: '我的空间', sessionId: 'session-a', rosterNo: 1, state: 'thinking', task: '处理 A' },
          { type: 'set_state', workspaceId: 'shared-child', workspaceName: '研究 Agent A', parentWorkspaceId: 'session-a', sessionId: 'session-a', rosterNo: 2, state: 'working', task: '研究 A' },
          { type: 'workspace_handoff', sessionId: 'session-a', fromWorkspaceId: 'session-a', toWorkspaceId: 'shared-child', phase: 'going', message: 'A 交接' },
          { type: 'register_artifact', workspaceId: 'shared-child', workspaceName: '研究 Agent A', parentWorkspaceId: 'session-a', sessionId: 'session-a', path: 'child-a.md' },
          { type: 'register_artifact', workspaceId: 'shared-child', workspaceName: '研究 Agent A', parentWorkspaceId: 'session-a', sessionId: 'session-a', path: 'child-final.md' },
          { type: 'register_artifact', workspaceId: 'shared-child', sessionId: 'session-a', path: 'missing.md' },
          { type: 'set_state', workspaceId: 'session-b', workspaceName: '我的空间', sessionId: 'session-b', rosterNo: 1, state: 'idle' },
          { type: 'set_state', workspaceId: 'shared-child', workspaceName: '研究 Agent B', parentWorkspaceId: 'session-b', sessionId: 'session-b', rosterNo: 4, state: 'working', task: '研究 B' },
          { type: 'workspace_handoff', sessionId: 'session-b', fromWorkspaceId: 'session-b', toWorkspaceId: 'shared-child', phase: 'returning', message: 'B 交接' },
          { type: 'register_artifact', workspaceId: 'shared-child', workspaceName: '研究 Agent B', parentWorkspaceId: 'session-b', sessionId: 'session-b', path: 'child-b.md' },
        ]),
      })
      expect(posted.status).toBe(202)
      const liveSessionA = await (await fetch(`${first.origin}/office/workspaces?sessionId=session-a`)).json()
      const liveSessionB = await (await fetch(`${first.origin}/office/workspaces?sessionId=session-b`)).json()
      expect(liveSessionA.find((item) => item.id === 'shared-child')).toMatchObject({ relation: { phase: 'going', message: 'A 交接' } })
      expect(liveSessionB.find((item) => item.id === 'shared-child')).toMatchObject({ relation: { phase: 'returning', message: 'B 交接' } })
      expect(liveSessionA.find((item) => item.id === 'shared-child').outputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'activity', text: '研究 A', rosterNo: 2 }),
        expect.objectContaining({ kind: 'handoff', text: 'A 交接' }),
        expect.objectContaining({ kind: 'artifact', text: '已生成产物：child-a.md' }),
      ]))
      const crossSession = await fetch(`${first.origin}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'workspace_handoff', fromWorkspaceId: 'session-a', toWorkspaceId: 'session-b', phase: 'going' }),
      })
      expect(crossSession.status).toBe(400)

      const stateFile = resolveWorkspaceProjectionStatePath(stateDirectory)
      expect(path.dirname(stateFile)).toBe(path.resolve(stateDirectory))
      expect(stateFile.startsWith(path.resolve(home))).toBe(false)
      expect((await readFile(stateFile, 'utf8')).split(/\r?\n/).filter(Boolean)).toHaveLength(2)
      await new Promise((resolve) => first.server.close(resolve))
      first = null

      await appendFile(stateFile, 'not-json\n{"version":1,"sessionId":"broken","workspaces":[{"id":"overview"}]}\n')
      await resetGatewayState()
      second = await createPersistentServer()

      const sessionA = await (await fetch(`${second.origin}/office/workspaces?sessionId=session-a`)).json()
      const sessionB = await (await fetch(`${second.origin}/office/workspaces?sessionId=session-b`)).json()
      expect(sessionA.map((item) => item.id)).toEqual(['session-a', 'shared-child'])
      expect(sessionB.map((item) => item.id)).toEqual(['session-b', 'shared-child'])
      expect(sessionA.find((item) => item.id === 'shared-child')).toMatchObject({ name: '研究' })
      expect(sessionB.find((item) => item.id === 'shared-child')).toMatchObject({ name: '研究' })
      expect(sessionA.find((item) => item.id === 'shared-child').relation).toBeUndefined()
      expect(sessionB.find((item) => item.id === 'shared-child').relation).toBeUndefined()
      expect(sessionA.find((item) => item.id === 'shared-child').agents.every((agent) => agent.state === 'idle')).toBe(true)
      expect(sessionB.find((item) => item.id === 'shared-child').agents.every((agent) => agent.state === 'idle')).toBe(true)
      expect(sessionA.find((item) => item.id === 'shared-child').outputs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'activity', text: '研究 A' }),
        expect.objectContaining({ kind: 'artifact', text: '已生成产物：child-a.md' }),
      ]))
      expect(sessionB.find((item) => item.id === 'shared-child').outputs.some((output) => output.text === '研究 A')).toBe(false)
      const allWorkspaces = await (await fetch(`${second.origin}/office/workspaces`)).json()
      expect(allWorkspaces.some((item) => item.sessionId === 'broken')).toBe(false)

      const mainArtifacts = await (await fetch(`${second.origin}/office/conversations/session-a/artifacts?workspaceId=session-a`)).json()
      const conversationArtifacts = await (await fetch(`${second.origin}/office/conversations/session-a/artifacts`)).json()
      const childAArtifacts = await (await fetch(`${second.origin}/office/conversations/session-a/artifacts?workspaceId=shared-child`)).json()
      const childBArtifacts = await (await fetch(`${second.origin}/office/conversations/session-b/artifacts?workspaceId=shared-child`)).json()
      expect(mainArtifacts.map((item) => item.path)).toEqual(['parent.md'])
      expect(conversationArtifacts.map((item) => item.path)).toEqual(['parent.md'])
      expect(childAArtifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ workspaceId: 'shared-child', sessionId: 'session-a', path: 'child-a.md' }),
        expect.objectContaining({ workspaceId: 'shared-child', sessionId: 'session-a', path: 'child-final.md' }),
      ]))
      expect(childAArtifacts).toHaveLength(2)
      expect(childBArtifacts).toEqual([expect.objectContaining({ workspaceId: 'shared-child', sessionId: 'session-b', path: 'child-b.md' })])
    } finally {
      if (first) await new Promise((resolve) => first.server.close(resolve))
      if (second) await new Promise((resolve) => second.server.close(resolve))
      await resetGatewayState()
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await rm(root, { recursive: true, force: true })
    }
  })

  it('把新动作和持久化恢复中的英文子空间名统一为中文', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-chinese-workspace-'))
    const stateDirectory = path.join(root, 'state')
    const previousHome = process.env.OPENPAW_HOME
    process.env.OPENPAW_HOME = path.join(root, 'home')
    const start = async () => {
      const server = createGatewayServer({ persistWorkspaceState: true, stateDirectory })
      await listenOnFetchSafePort(server)
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
      return { server, origin: `http://127.0.0.1:${String(address.port)}` }
    }
    let running
    try {
      running = await start()
      const accepted = await fetch(`${running.origin}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          type: 'set_state', workspaceId: 'english-child', workspaceName: 'audit-review', parentWorkspaceId: 'english-session', sessionId: 'english-session', rosterNo: 6, state: 'working', task: 'review release',
        }),
      })
      expect(accepted.status).toBe(202)
      expect((await (await fetch(`${running.origin}/office/workspaces?sessionId=english-session`)).json()).find((item) => item.id === 'english-child').name).toBe('审核验收')
      await new Promise((resolve) => running.server.close(resolve))
      running = await start()
      expect((await (await fetch(`${running.origin}/office/workspaces?sessionId=english-session`)).json()).find((item) => item.id === 'english-child').name).toBe('审核验收')
    } finally {
      if (running?.server.listening) await new Promise((resolve) => running.server.close(resolve))
      await resetGatewayState()
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('register_artifact 拒绝越界路径，未知子空间和不存在文件返回空数组', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-workspace-artifact-'))
    const stateDirectory = path.join(root, 'state')
    const workspace = path.join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    const server = createGatewayServer({ persistWorkspaceState: true, stateDirectory })
    await listenOnFetchSafePort(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
    const origin = `http://127.0.0.1:${String(address.port)}`
    try {
      const invalid = await fetch(`${origin}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'register_artifact', workspaceId: 'child', sessionId: 'session', path: '../secret.md' }) })
      expect(invalid.status).toBe(400)
      const missing = await fetch(`${origin}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'register_artifact', workspaceId: 'child', parentWorkspaceId: 'session', sessionId: 'session', path: 'missing.md' }) })
      expect(missing.status).toBe(202)
      expect(await (await fetch(`${origin}/office/conversations/session/artifacts?workspaceId=child`)).json()).toEqual([])
      expect(await (await fetch(`${origin}/office/conversations/session/artifacts?workspaceId=unknown`)).json()).toEqual([])
    } finally {
      await new Promise((resolve) => server.close(resolve))
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await resetGatewayState()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('拒绝把 AI Office 空间状态写入 OPENPAW_HOME', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'ai-office-state-boundary-'))
    const previousHome = process.env.OPENPAW_HOME
    process.env.OPENPAW_HOME = home
    try {
      expect(() => createGatewayServer({ persistWorkspaceState: true, stateDirectory: path.join(home, 'office-state') })).toThrow('不得位于 OPENPAW_HOME 内')
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    }
  })

  it('旧的跨空间完成事件不会删除后来建立的新交接关系', async () => {
    const server = createGatewayServer()
    await listenOnFetchSafePort(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
    const origin = `http://127.0.0.1:${String(address.port)}`
    const post = (data) => fetch(`${origin}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    try {
      expect((await post({ type: 'workspace_handoff', fromWorkspaceId: 'agent-a', toWorkspaceId: 'agent-b', phase: 'going' })).status).toBe(202)
      expect((await post({ type: 'workspace_handoff', fromWorkspaceId: 'agent-a', toWorkspaceId: 'agent-c', phase: 'going' })).status).toBe(202)
      const concurrent = await (await fetch(`${origin}/office/workspaces`)).json()
      expect(concurrent.find((workspace) => workspace.id === 'agent-a').relations).toEqual(expect.arrayContaining([
        expect.objectContaining({ peerWorkspaceId: 'agent-b', direction: 'outgoing' }),
        expect.objectContaining({ peerWorkspaceId: 'agent-c', direction: 'outgoing' }),
      ]))
      expect((await post({ type: 'workspace_handoff', fromWorkspaceId: 'agent-a', toWorkspaceId: 'agent-b', phase: 'complete' })).status).toBe(202)
      const workspaces = await (await fetch(`${origin}/office/workspaces`)).json()
      expect(workspaces.find((workspace) => workspace.id === 'agent-a').relation).toMatchObject({ peerWorkspaceId: 'agent-c', direction: 'outgoing' })
      expect(workspaces.find((workspace) => workspace.id === 'agent-a').relations).toHaveLength(1)
      expect(workspaces.find((workspace) => workspace.id === 'agent-b').relation).toBeUndefined()
      expect(workspaces.find((workspace) => workspace.id === 'agent-c').relation).toMatchObject({ peerWorkspaceId: 'agent-a', direction: 'incoming' })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('解析包含嵌套值的 YAML frontmatter', () => {
    const parsed = parseFrontmatter('---\nname: research\ntags:\n  - web\n---\nbody')
    expect(parsed.data).toMatchObject({ name: 'research', tags: ['web'] })
    expect(parsed.body).toBe('body')
  })

  it('提供读取即清空的 HTTP 动作接口和数组形式的办公室接口', async () => {
    const server = createGatewayServer()
    await listenOnFetchSafePort(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
    const origin = `http://127.0.0.1:${String(address.port)}`
    try {
      const bad = await fetch(`${origin}/actions`, { method: 'POST', body: JSON.stringify([{ type: 'set_state', rosterNo: 1, state: 'thinking' }, null]) })
      expect(bad.status).toBe(400)
      expect((await fetch(`${origin}/actions`, { method: 'POST', body: '' })).status).toBe(400)
      expect((await fetch(`${origin}/actions`, { method: 'POST', body: JSON.stringify({ type: 'set_state', rosterNo: 1, state: 'busy' }) })).status).toBe(400)
      const accepted = await fetch(`${origin}/actions`, { method: 'POST', body: JSON.stringify({ type: 'set_state', rosterNo: 1, state: 'thinking' }) })
      expect(accepted.status).toBe(202)
      const latest = await (await fetch(`${origin}/actions?after=latest`)).json()
      expect(latest).toMatchObject({ actions: [], nextCursor: 1, gap: false, reset: false })
      const secondAccepted = await fetch(`${origin}/actions`, { method: 'POST', body: JSON.stringify({ type: 'set_state', rosterNo: 2, state: 'working' }) })
      expect(secondAccepted.status).toBe(202)
      const incremental = await (await fetch(`${origin}/actions?after=${String(latest.nextCursor)}`)).json()
      expect(incremental).toMatchObject({
        actions: [{ type: 'set_state', rosterNo: 2, state: 'working' }],
        nextCursor: 2,
        gap: false,
        reset: false,
      })
      expect((await fetch(`${origin}/actions?after=invalid`)).status).toBe(400)
      expect((await (await fetch(`${origin}/actions`)).json()).actions).toHaveLength(2)
      expect((await (await fetch(`${origin}/actions`)).json()).actions).toHaveLength(0)
      expect((await fetch(`${origin}/actions`, { method: 'PUT' })).status).toBe(405)
      const route = await fetch(`${origin}/office/agents`)
      expect(route.status).toBe(200)
      expect(Array.isArray(await route.json())).toBe(true)
      const workspaces = await fetch(`${origin}/office/workspaces`)
      expect(workspaces.status).toBe(200)
      expect(Array.isArray(await workspaces.json())).toBe(true)
      expect((await fetch(`${origin}/office/toString`)).status).toBe(404)
      expect((await fetch(`${origin}/health`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
      const cors = await fetch(`${origin}/health`, { headers: { Origin: 'http://127.0.0.1:5173' } })
      expect(cors.status).toBe(200)
      expect(cors.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('按 T11 字段和限制扫描指定主目录及工作区', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-gateway-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await Promise.all([
      mkdir(path.join(home, 'sessions'), { recursive: true }),
      mkdir(path.join(home, 'skills', 'fallback'), { recursive: true }),
      mkdir(path.join(home, 'goals'), { recursive: true }),
      mkdir(path.join(workspace, 'src', 'nested'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(path.join(home, 'sessions', 'session-a.jsonl'), '{"type":"meta","id":"a","provider":"echo","model":"echo-1","created_at":"2026-01-01T00:00:00Z"}\n'),
      writeFile(path.join(home, 'sessions', 'session-b.jsonl'), '{"type":"meta","id":"b"}\nnot-json\n'),
      writeFile(path.join(home, 'skills', 'fallback', 'SKILL.md'), '# no frontmatter'),
      writeFile(path.join(home, 'goals', 'goal-b.md'), '---\nobjective: Ship B\nstatus: blocked\npriority: 2\nnext_action: Review\n---\n'),
      writeFile(path.join(home, 'goals', 'broken.md'), '---\n: invalid: [\n---\n'),
      writeFile(path.join(workspace, 'README.md'), 'readme'),
      writeFile(path.join(workspace, 'src', 'app.ts'), 'app'),
      writeFile(path.join(workspace, 'src', 'nested', 'deep.ts'), 'deep'),
    ])
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    try {
      await utimes(path.join(home, 'sessions', 'session-a.jsonl'), 1, 2)
      await expect(listSessions()).resolves.toEqual([{ id: 'a', title: 'New session', provider: 'echo', model: 'echo-1', createdAt: 1767225600000, updatedAt: 2000 }])
      await writeFile(path.join(home, 'sessions', 'named.jsonl'), '{"type":"meta","id":"named","provider":"openai","model":"gpt-4o"}\n{"type":"metadata","title":"命名空会话"}\n')
      await expect(listSessions()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'named', title: '命名空会话', provider: 'openai', model: 'gpt-4o' })]))
      await expect(listSkills()).resolves.toEqual([{ name: 'fallback', path: 'skills/fallback/SKILL.md' }])
      await expect(listTasks()).resolves.toEqual([{ id: 'goal-b', objective: 'Ship B', status: 'blocked', priority: 2, nextAction: 'Review' }])
      const files = await listFiles()
      expect(files).toEqual([{ path: 'README.md', type: 'file' }, { path: 'src', type: 'directory' }, { path: 'src/app.ts', type: 'file' }, { path: 'src/nested', type: 'directory' }])
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('未配置工作区时不扫描 Gateway 启动目录', async () => {
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_OFFICE_WORKSPACE = '   '
    const server = createGatewayServer(); await listenOnFetchSafePort(server)
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
    const origin = `http://127.0.0.1:${String(address.port)}`
    try {
      await expect(listFiles()).resolves.toEqual([])
      await expect(readWorkspaceFile('package.json')).rejects.toMatchObject({ code: 'invalid_configuration' })
      expect(await (await fetch(`${origin}/office/files`)).json()).toEqual([])
      expect(await (await fetch(`${origin}/office/workspace`)).json()).toEqual({ root: '' })
      expect((await fetch(`${origin}/office/file?path=package.json`)).status).toBe(503)
    } finally {
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('不跟随指定根目录的符号链接', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-symlink-'))
    const target = path.join(root, 'target')
    const link = path.join(root, 'link')
    await mkdir(path.join(target, 'sessions'), { recursive: true })
    await writeFile(path.join(target, 'visible.txt'), 'outside')
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_HOME = link
    process.env.OPENPAW_OFFICE_WORKSPACE = link
    try {
      await expect(listSessions()).resolves.toEqual([])
      await expect(listFiles()).resolves.toEqual([])
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await rm(root, { recursive: true, force: true })
    }
  })

  it('按确定顺序执行会话和文件数量限制', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-limits-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await mkdir(path.join(home, 'sessions'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await Promise.all(Array.from({ length: 55 }, async (_, index) => {
      const file = path.join(home, 'sessions', `session-${String(index).padStart(2, '0')}.jsonl`)
      await writeFile(file, JSON.stringify({ type: 'meta', id: `s${index}`, provider: 'echo', model: 'echo-1' }) + '\n')
      await utimes(file, index + 1, index + 1)
    }))
    await Promise.all(Array.from({ length: 205 }, (_, index) => writeFile(path.join(workspace, `file-${String(index).padStart(3, '0')}.txt`), 'x')))
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    try {
      const sessions = await listSessions()
      expect(sessions).toHaveLength(50)
      expect(sessions[0].id).toBe('s54')
      expect(sessions.at(-1).id).toBe('s5')
      const files = await listFiles()
      expect(files).toHaveLength(200)
      expect(files[0].path).toBe('file-000.txt')
      expect(files.at(-1).path).toBe('file-199.txt')
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('只读取工作区内的普通文件并拒绝越界、符号链接和超大文件', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-file-content-'))
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside.txt')
    await mkdir(workspace, { recursive: true })
    await writeFile(path.join(workspace, 'README.md'), '# 办公室\n内容')
    await writeFile(outside, 'outside')
    await symlink(outside, path.join(workspace, 'linked.txt'), process.platform === 'win32' ? 'junction' : 'file')
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    try {
      await expect(readWorkspaceFile('README.md')).resolves.toEqual({ path: 'README.md', content: '# 办公室\n内容' })
      await expect(readWorkspaceFile('../outside.txt')).rejects.toMatchObject({ code: 'forbidden' })
      await expect(readWorkspaceFile('linked.txt')).rejects.toMatchObject({ code: 'forbidden' })
      await expect(readWorkspaceFile('missing.txt')).rejects.toMatchObject({ code: 'not_found' })
      const server = createGatewayServer()
      await listenOnFetchSafePort(server)
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
      try {
        const response = await fetch(`http://127.0.0.1:${String(address.port)}/office/file?path=${encodeURIComponent('README.md')}`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ path: 'README.md', content: '# 办公室\n内容' })
        expect((await fetch(`http://127.0.0.1:${String(address.port)}/office/file?path=${encodeURIComponent('../outside.txt')}`)).status).toBe(403)
      } finally { await new Promise((resolve) => server.close(resolve)) }
    } finally {
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await rm(root, { recursive: true, force: true })
    }
  })

  it('通过网关按顺序创建会话并触发 OpenPaw prompt', async () => {
    const calls = []
    const engine = createServer((req, res) => {
      calls.push({ method: req.method, url: req.url, body: null, directory: req.headers['x-opencode-directory'] })
      let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
        calls[calls.length - 1].body = body ? JSON.parse(body) : null
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/session' && req.method === 'POST') { res.statusCode = 201; res.end(JSON.stringify({ id: 'engine-1', title: '引擎会话', time: { created: 10, updated: 11 } })); return }
        if (req.url === '/session/engine-1/prompt_async' && req.method === 'POST') { expect(JSON.parse(body).parts?.[0]?.type).toBe('text'); res.setHeader('OpenPaw-Turn-ID', 'turn-engine-1'); res.statusCode = 204; res.end(); return }
        if (req.url === '/session/engine-1' && req.method === 'DELETE') { res.statusCode = 204; res.end(); return }
        res.statusCode = 404; res.end('{}')
      })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    const previousUser = process.env.OPENCODE_SERVER_USERNAME
    const previousPassword = process.env.OPENCODE_SERVER_PASSWORD
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    process.env.OPENCODE_SERVER_USERNAME = 'office'
    process.env.OPENCODE_SERVER_PASSWORD = 'secret'
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新任务', text: '执行任务', provider: 'echo', model: 'echo-1', directory: 'D:\\workspace' }) })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ promptAccepted: true, session: { id: 'engine-1', title: '引擎会话', provider: 'echo', model: 'echo-1', createdAt: 10, updatedAt: 11 } })
      const message = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/engine-1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: 'office-stable-1', text: '追加消息' }) })
      expect(message.status).toBe(202)
      expect(await message.json()).toMatchObject({ accepted: true, sessionId: 'engine-1', turnID: 'turn-engine-1' })
      expect((await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/tasks`, { method: 'POST', body: '{}' })).status).toBe(400)
      const deleted = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/engine-1`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      expect(calls.map((call) => call.url)).toEqual(['/session', '/session/engine-1/prompt_async', '/session/engine-1/prompt_async', '/session/engine-1'])
      expect(calls[0].directory).toBe('D:\\workspace')
      expect(calls[0].body).not.toHaveProperty('directory')
      expect(calls[2].body).toMatchObject({ requestID: 'office-stable-1', parts: [{ type: 'text', text: '追加消息' }] })
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      if (previousUser === undefined) delete process.env.OPENCODE_SERVER_USERNAME
      else process.env.OPENCODE_SERVER_USERNAME = previousUser
      if (previousPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
      else process.env.OPENCODE_SERVER_PASSWORD = previousPassword
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('按会话重建成功文件产物并忽略失败、越界和损坏记录', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-artifacts-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await mkdir(path.join(home, 'sessions'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await mkdir(path.join(workspace, '最终交付'), { recursive: true })
    await mkdir(path.join(workspace, '过程资料'), { recursive: true })
    await writeFile(path.join(workspace, 'report.md'), '# 报告')
    await writeFile(path.join(workspace, 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    await writeFile(path.join(workspace, 'trend.chart.json'), JSON.stringify({ type: 'line', title: '趋势', categories: ['一', '二'], series: [{ name: '产出', data: [1, 2] }] }))
    await writeFile(path.join(workspace, 'route.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }))
    await writeFile(path.join(workspace, 'deliverable.js'), 'console.log("deliverable")')
    await writeFile(path.join(workspace, 'process.py'), 'print("temporary")')
    await writeFile(path.join(workspace, 'draft.md'), '# 草稿')
    await writeFile(path.join(workspace, '最终交付', '既有互动地图.html'), '<!doctype html><title>地图</title>')
    await writeFile(path.join(workspace, '最终交付', '既有产物索引.md'), '# 索引')
    await writeFile(path.join(workspace, '过程资料', '核验脚本.js'), 'console.log("process")')
    const lines = [
      { type: 'meta', id: 'artifact-session' },
      { type: 'turn_accept_v1', outcome: { turnID: 'turn-artifact' }, message: { role: 'user', content: [{ type: 'text', text: '生成最终报告' }] } },
      { type: 'message', role: 'assistant', content: [
        { type: 'tool_use', id: 'ok-doc', name: 'write_file', input: { path: 'report.md', content: 'private' } },
        { type: 'tool_use', id: 'failed', name: 'write_file', input: { path: 'failed.md' } },
        { type: 'tool_use', id: 'outside', name: 'write_file', input: { path: '../outside.md' } },
        { type: 'tool_use', id: 'image', name: 'edit_file', input: { path: 'chart.svg' } },
        { type: 'tool_use', id: 'data-chart', name: 'write_file', input: { path: 'trend.chart.json' } },
        { type: 'tool_use', id: 'map-route', name: 'write_file', input: { path: 'route.geojson' } },
        { type: 'tool_use', id: 'script-output', name: 'write_file', input: { path: 'deliverable.js' } },
        { type: 'tool_use', id: 'process-output', name: 'write_file', input: { path: 'process.py' } },
        { type: 'tool_use', id: 'draft-output', name: 'write_file', input: { path: 'draft.md' } },
      ] },
      { type: 'message', role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'ok-doc', is_error: false },
        { type: 'tool_result', tool_use_id: 'failed', is_error: true },
        { type: 'tool_result', tool_use_id: 'outside', is_error: false },
        { type: 'tool_result', tool_use_id: 'image', is_error: false },
        { type: 'tool_result', tool_use_id: 'data-chart', is_error: false },
        { type: 'tool_result', tool_use_id: 'map-route', is_error: false },
        { type: 'tool_result', tool_use_id: 'script-output', is_error: false },
        { type: 'tool_result', tool_use_id: 'process-output', is_error: false },
        { type: 'tool_result', tool_use_id: 'draft-output', is_error: false },
      ] },
      { type: 'message', role: 'assistant', content: [{ type: 'text', text: '过程文件（不作为交付）：\n- `process.py`\n- `draft.md`\n- `过程资料/核验脚本.js`\n\n最终产物清单：\n- `report.md`\n- `chart.svg`\n- `trend.chart.json`\n- `route.geojson`\n- `deliverable.js`\n- [既有互动地图](最终交付/既有互动地图.html)\n- 最终交付/既有产物索引.md' }] },
    ]
    await writeFile(path.join(home, 'sessions', 'artifact-session.jsonl'), `${lines.map((line) => JSON.stringify(line)).join('\n')}\nnot-json\n`)
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    try {
      await expect(listConversationArtifacts('artifact-session')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: 'artifact-session', path: 'report.md', kind: 'markdown', mimeType: 'text/markdown; charset=utf-8' }),
        expect.objectContaining({ sessionId: 'artifact-session', path: 'chart.svg', kind: 'image', mimeType: 'image/svg+xml' }),
        expect.objectContaining({ sessionId: 'artifact-session', path: 'trend.chart.json', kind: 'diagram', mimeType: 'application/vnd.ai-office.chart+json; charset=utf-8' }),
        expect.objectContaining({ sessionId: 'artifact-session', path: 'route.geojson', kind: 'data', mimeType: 'application/geo+json; charset=utf-8' }),
        expect.objectContaining({ sessionId: 'artifact-session', path: 'deliverable.js', kind: 'text', mimeType: 'text/javascript; charset=utf-8' }),
        expect.objectContaining({ sessionId: 'artifact-session', path: '最终交付/既有互动地图.html', kind: 'document', mimeType: 'text/html; charset=utf-8' }),
        expect.objectContaining({ sessionId: 'artifact-session', path: '最终交付/既有产物索引.md', kind: 'markdown', mimeType: 'text/markdown; charset=utf-8' }),
      ]))
      expect(await listConversationArtifacts('artifact-session')).toHaveLength(7)
      expect(await listConversationArtifacts('artifact-session', 'artifact-session')).toHaveLength(7)
      expect((await listConversationArtifacts('artifact-session')).some((item) => item.path === 'process.py')).toBe(false)
      expect((await listConversationArtifacts('artifact-session')).some((item) => item.path === 'draft.md')).toBe(false)
      expect((await listConversationArtifacts('artifact-session')).some((item) => item.path === '过程资料/核验脚本.js')).toBe(false)
      await expect(listConversationArtifacts('../artifact-session')).rejects.toMatchObject({ code: 'invalid_path' })

      const server = createGatewayServer(); await listenOnFetchSafePort(server)
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
      try {
        const origin = `http://127.0.0.1:${String(address.port)}`
        const artifacts = await fetch(`${origin}/office/conversations/artifact-session/artifacts`)
        expect(artifacts.status).toBe(200)
        expect(await artifacts.json()).toHaveLength(7)
        const mainArtifacts = await fetch(`${origin}/office/conversations/artifact-session/artifacts?workspaceId=artifact-session`)
        expect(mainArtifacts.status).toBe(200)
        expect(await mainArtifacts.json()).toHaveLength(7)
        const image = await fetch(`${origin}/office/artifact-image?path=${encodeURIComponent('chart.svg')}`)
        expect(image.status).toBe(200)
        expect(image.headers.get('content-type')).toBe('image/svg+xml')
        expect((await fetch(`${origin}/office/artifact-image?path=${encodeURIComponent('report.md')}`)).status).toBe(400)
      } finally { await new Promise((resolve) => server.close(resolve)) }
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE
      else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await rm(root, { recursive: true, force: true })
    }
  })

  it('Host 已接收但响应断开时用同一 requestID 重试且只产生一个逻辑回合', async () => {
    const requestIds = []
    const accepted = new Set()
    let logicalTurns = 0
    const engine = createServer((req, res) => {
      let body = ''; req.on('data', (chunk) => { body += chunk }); req.on('end', () => {
        if (req.url !== '/session/idempotent/prompt_async' || req.method !== 'POST') { res.statusCode = 404; res.end('{}'); return }
        const payload = JSON.parse(body)
        requestIds.push(payload.requestID)
        if (!accepted.has(payload.requestID)) {
          accepted.add(payload.requestID)
          logicalTurns += 1
          req.socket.destroy()
          return
        }
        res.statusCode = 204; res.end()
      })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/idempotent/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: 'office-response-loss-1', text: '只执行一次' }),
      })
      expect(response.status).toBe(202)
      expect(requestIds).toEqual(['office-response-loss-1', 'office-response-loss-1'])
      expect(logicalTurns).toBe(1)
      const invalid = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/idempotent/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: '中文-id', text: '拒绝无效键' }),
      })
      expect(invalid.status).toBe(400)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('合并同一会话和 requestID 的并发提交，并短暂重放已完成确认', async () => {
    let hostPosts = 0
    const engine = createServer((req, res) => {
      if (req.url !== '/session/merged/prompt_async' || req.method !== 'POST') { res.statusCode = 404; res.end('{}'); return }
      hostPosts += 1
      req.resume()
      req.on('end', () => setTimeout(() => {
        res.setHeader('OpenPaw-Turn-ID', 'turn-merged')
        res.statusCode = 204
        res.end()
      }, 40))
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    const url = `http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/merged/messages`
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: 'office-merged-1', text: '合并提交' }) }
    try {
      const concurrent = await Promise.all([fetch(url, init), fetch(url, init), fetch(url, init)])
      expect(concurrent.map((response) => response.status)).toEqual([202, 202, 202])
      await expect(Promise.all(concurrent.map((response) => response.json()))).resolves.toEqual([
        { accepted: true, sessionId: 'merged', turnID: 'turn-merged' },
        { accepted: true, sessionId: 'merged', turnID: 'turn-merged' },
        { accepted: true, sessionId: 'merged', turnID: 'turn-merged' },
      ])
      const replay = await fetch(url, init)
      expect(replay.status).toBe(202)
      expect(await replay.json()).toEqual({ accepted: true, sessionId: 'merged', turnID: 'turn-merged' })
      expect(hostPosts).toBe(1)

      const conflict = await fetch(url, { ...init, body: JSON.stringify({ requestID: 'office-merged-1', text: '不同正文' }) })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toEqual({ error: 'requestID 已用于不同的消息请求', code: 'idempotency_conflict', retryable: false })
      expect(hostPosts).toBe(1)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('Host 首次拒绝且未入场时不缓存失败 Promise，恢复后允许同一 requestID 重试', async () => {
    let hostPosts = 0
    const engine = createServer((req, res) => {
      if (req.url !== '/session/retryable/prompt_async' || req.method !== 'POST') { res.statusCode = 404; res.end('{}'); return }
      hostPosts += 1
      req.resume()
      req.on('end', () => {
        if (hostPosts === 1) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Host 暂时不可用', code: 'provider_server_error', retryable: true }))
          return
        }
        res.setHeader('OpenPaw-Turn-ID', 'turn-retryable')
        res.statusCode = 204
        res.end()
      })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    const url = `http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/retryable/messages`
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: 'office-retryable-1', text: '恢复后重试' }) }
    try {
      const first = await fetch(url, init)
      expect(first.status).toBe(503)
      expect(await first.json()).toMatchObject({ code: 'provider_server_error', retryable: true })
      const second = await fetch(url, init)
      expect(second.status).toBe(202)
      expect(await second.json()).toEqual({ accepted: true, sessionId: 'retryable', turnID: 'turn-retryable' })
      expect(hostPosts).toBe(2)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('创建会话首次失败后不缓存旧 Promise，相同 requestID 可在 Host 恢复后重试', async () => {
    let createCalls = 0
    const engine = createServer((req, res) => {
      if (req.url !== '/session' || req.method !== 'POST') { res.statusCode = 404; res.end('{}'); return }
      createCalls += 1
      req.resume()
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        if (createCalls === 1) { res.statusCode = 503; res.end('{}'); return }
        res.statusCode = 201; res.end(JSON.stringify({ id: 'create-recovered' }))
      })
    })
    await listenOnFetchSafePort(engine)
    const address = engine.address()
    if (!address || typeof address === 'string') throw new Error('测试引擎未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(address.port)}`
    const payload = { requestID: 'office-create-retry-1', title: '恢复创建' }
    try {
      await expect(createOfficeConversation(payload)).rejects.toMatchObject({ code: 'engine_error', status: 503 })
      await expect(createOfficeConversation(payload)).resolves.toMatchObject({ session: { id: 'create-recovered' } })
      expect(createCalls).toBe(2)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('保留 Host 非 2xx 响应的 code 和 retryable', async () => {
    const engine = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.statusCode = 409
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: '已有活动回合', code: 'active_turn', retryable: true }))
      })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/error/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: 'office-active-1', text: '重复消息' }),
      })
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: '已有活动回合', code: 'active_turn', retryable: true })
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('批量状态路由一次返回全部活动会话并保留单会话兼容路由', async () => {
    let statusCalls = 0
    const engine = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/session/status') {
        statusCalls += 1
        res.end(JSON.stringify({ a: { type: 'busy', turnID: 'ta' }, b: { type: 'queued', turnID: 'tb', queuePosition: 2 } }))
        return
      }
      res.statusCode = 404; res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    const origin = `http://127.0.0.1:${String(gatewayAddress.port)}`
    try {
      expect(await (await fetch(`${origin}/office/conversations/status`)).json()).toEqual({ a: { type: 'busy', turnID: 'ta' }, b: { type: 'queued', turnID: 'tb', queuePosition: 2 } })
      expect(await (await fetch(`${origin}/office/conversations/a/status`)).json()).toEqual({ a: { type: 'busy', turnID: 'ta' } })
      expect(await (await fetch(`${origin}/office/conversations/missing/status`)).json()).toEqual({})
      expect(statusCalls).toBe(3)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('只读本地会话摘要并对并发请求复用缓存', async () => {
    const engine = createServer((_req, res) => { res.statusCode = 500; res.end('{}') })
    await listenOnFetchSafePort(engine)
    const home = await mkdtemp(path.join(os.tmpdir(), 'office-session-local-'))
    await mkdir(path.join(home, 'sessions'), { recursive: true })
    await writeFile(path.join(home, 'sessions', 'older.jsonl'), [
      { type: 'meta', id: 'older', provider: 'echo', model: 'echo-1', created_at: 1 },
      { type: 'metadata', title: '较早' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n')
    await writeFile(path.join(home, 'sessions', 'newer.jsonl'), [
      { type: 'meta', id: 'newer', provider: 'openai', model: 'gpt5.6', created_at: 3 },
      { type: 'metadata', title: '较新' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    const previousHome = process.env.OPENPAW_HOME
    process.env.OPENPAW_ENGINE_HOST_URL = 'http://127.0.0.1:1'
    process.env.OPENPAW_HOME = home
    try {
      await utimes(path.join(home, 'sessions', 'older.jsonl'), 4, 4)
      await utimes(path.join(home, 'sessions', 'newer.jsonl'), 4, 4)
      const [first, second] = await Promise.all([listOfficeSessions(true), listOfficeSessions(true)])
      expect(first).toEqual(second)
      expect(first.map((item) => item.id)).toEqual(['newer', 'older'])
      expect(first[0]).toEqual({ id: 'newer', title: '较新', provider: 'openai', model: 'gpt5.6', createdAt: 3000, updatedAt: 4000 })
      expect(JSON.stringify(first)).not.toContain('secret')
      expect(engine.listening).toBe(true)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      await resetGatewayState()
      await new Promise((resolve) => engine.close(resolve))
      await rm(home, { recursive: true, force: true })
    }
  })

  it('Office 对话消息路由只返回白名单文本字段', async () => {
    const engine = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/session/redaction/message' && req.method === 'GET') {
          res.statusCode = 200
          res.end(JSON.stringify([
            {
              info: { id: 'm-user', sessionID: 'redaction', role: 'user', time: { created: 1 }, extra: 'omit' },
              parts: [
                { id: 'p-user', messageID: 'm-user', sessionID: 'redaction', type: 'text', text: '用户文本', extra: 'omit' },
                { id: 'tool-1', type: 'tool', tool: 'read_file', state: { input: { path: 'secret' }, output: '秘密', error: '' } },
                { id: 'reasoning-1', type: 'reasoning', text: '内部推理' },
              ],
              extra: 'omit',
            },
            {
              info: { id: 'm-assistant', sessionID: 'redaction', role: 'assistant', time: { completed: 2 }, extra: 'omit' },
              parts: [{ id: 'p-assistant', messageID: 'm-assistant', sessionID: 'redaction', type: 'text', text: '助手文本' }],
            },
          ]))
          return
        }
        res.statusCode = 404
        res.end('{}')
      })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const direct = filterOfficeConversationMessages([
        { info: { id: 'x', unknown: true, time: { created: 1, unknown: { secret: true } } }, parts: [{ type: 'tool', state: { input: 'secret' } }, { type: 'text', text: '保留' }, { type: 'text', text: { secret: true } }] },
        { info: { id: 'tool-user', role: 'user' }, parts: [{ type: 'tool_result', state: { output: 'secret' } }] },
        { info: { id: 'blank-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '   ' }] },
      ])
      expect(direct).toEqual([{ info: { id: 'x', time: { created: 1 } }, parts: [{ type: 'text', text: '保留' }] }])
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/redaction/messages`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual([
        { info: { id: 'm-user', sessionID: 'redaction', role: 'user', time: { created: 1 } }, parts: [{ id: 'p-user', messageID: 'm-user', sessionID: 'redaction', type: 'text', text: '用户文本' }] },
        { info: { id: 'm-assistant', sessionID: 'redaction', role: 'assistant', time: { completed: 2 } }, parts: [{ id: 'p-assistant', messageID: 'm-assistant', sessionID: 'redaction', type: 'text', text: '助手文本' }] },
      ])
      expect(JSON.stringify(body)).not.toContain('secret')
      expect(JSON.stringify(body)).not.toContain('内部推理')
      expect(JSON.stringify(body)).not.toContain('output')
      expect(JSON.stringify(body)).not.toMatch(/state|input|output|error/)
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('按稳定错误码区分限流、过载、服务错误和协议错误正文', () => {
    const messages = [
      ['provider_rate_limited', '模型服务请求过于频繁'],
      ['provider_overloaded', '模型服务当前负载过高'],
      ['provider_server_error', '模型服务发生服务器错误'],
      ['provider_protocol_error', '模型服务返回了不完整响应'],
    ]
    for (const [code, expected] of messages) {
      const merged = mergeOfficeConversationTurns(
        [{ info: { id: `user-${code}`, role: 'user' }, parts: [{ type: 'text', text: '问题' }] }],
        [{ turnID: `turn-${code}`, userMessageID: `user-${code}`, state: 'failed', error: { code, retryable: true } }],
        'error-codes',
      )
      expect(merged.at(-1)?.parts?.[0]?.text).toContain(expected)
    }
  })

  it('把失败和取消终态作为脱敏 system 正文插入对应回合', () => {
    const messages = [
      { info: { id: 'u1', sessionID: 's1', role: 'user' }, parts: [{ type: 'text', text: '第一问' }] },
      { info: { id: 'u2', sessionID: 's1', role: 'user' }, parts: [{ type: 'text', text: '第二问' }] },
    ]
    const turns = [
      { turnID: 't1', userMessageID: 'u1', state: 'failed', completedAt: 20, error: { code: 'provider_timeout', message: 'raw upstream secret', retryable: true } },
      { turnID: 't2', userMessageID: 'u2', state: 'cancelled', completedAt: 30, error: { code: 'cancelled', message: 'raw cancel', retryable: false } },
    ]
    const result = mergeOfficeConversationTurns(messages, turns, 's1')
    expect(result.map((item) => [item.info.role, item.info.kind, item.parts[0]?.text])).toEqual([
      ['user', undefined, '第一问'],
      ['system', 'error', '模型服务响应超时，本轮未完成，请稍后重试。'],
      ['user', undefined, '第二问'],
      ['system', 'cancelled', '本轮已停止。'],
    ])
    expect(JSON.stringify(result)).not.toContain('raw upstream secret')
    expect(JSON.stringify(result)).not.toContain('raw cancel')
  })

  it('只用目标 userMessageID 回合窗口内的非空 assistant 证明完成', () => {
    const terminal = { turnID: 'target-turn', userMessageID: 'target-user', state: 'completed' }
    const messages = [
      { info: { id: 'old-user', role: 'user' }, parts: [{ type: 'text', text: '旧问题' }] },
      { info: { id: 'old-assistant', role: 'assistant', turnID: 'old-turn' }, parts: [{ type: 'text', text: '旧回复' }] },
      { info: { id: 'target-user', role: 'user' }, parts: [{ type: 'text', text: '当前问题' }] },
      { info: { id: 'target-tool', role: 'assistant', turnID: 'target-turn' }, parts: [{ type: 'tool', text: '内部工具' }] },
      { info: { id: 'target-empty', role: 'assistant', turnID: 'target-turn' }, parts: [{ type: 'text', text: '   ' }] },
      { info: { id: 'next-user', role: 'user' }, parts: [{ type: 'text', text: '下一问' }] },
      { info: { id: 'next-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '下一轮回复' }] },
    ]
    expect(turnHasAssistantText(messages, terminal)).toBe(false)
    expect(turnHasAssistantText([
      ...messages.slice(0, 5),
      { info: { id: 'target-assistant', role: 'assistant', turnID: 'target-turn' }, parts: [{ type: 'text', text: '当前有效回复' }] },
      ...messages.slice(5),
    ], terminal)).toBe(true)
    expect(turnHasAssistantText(messages, { ...terminal, userMessageID: '' })).toBe(false)

    expect(turnHasAssistantText([
      ...messages.slice(0, 3),
      { info: { id: 'tool-user', role: 'user' }, parts: [] },
      { info: { id: 'tool-assistant', role: 'assistant', turnID: 'target-turn' }, parts: [{ type: 'text', text: '工具调用后的最终回复' }] },
    ], terminal)).toBe(true)

    const projected = mergeOfficeConversationTurns(messages, [terminal], 's-window')
    expect(projected.find((item) => item.info?.turnID === 'target-turn' && item.info?.role === 'system')).toMatchObject({
      info: { role: 'system', kind: 'error' },
      parts: [{ type: 'text', text: '本轮已结束，但未收到智能体的有效回复，请重新发送。' }],
    })
  })

  it('完成标记位于工具循环后的最终正文之后', () => {
    const messages = [
      { info: { id: 'target-user', role: 'user' }, parts: [{ type: 'text', text: '生成文件' }] },
      { info: { id: 'process', role: 'assistant', turnID: 'target-turn' }, parts: [{ type: 'text', text: '正在处理' }] },
      { info: { id: 'tool-user', role: 'user' }, parts: [] },
      { info: { id: 'final', role: 'assistant', turnID: 'target-turn' }, parts: [{ type: 'text', text: '已生成 output.js' }] },
      { info: { id: 'next-user', role: 'user' }, parts: [{ type: 'text', text: '下一问' }] },
    ]
    const projected = mergeOfficeConversationTurns(messages, [{ turnID: 'target-turn', userMessageID: 'target-user', state: 'completed' }], 's-order')

    expect(projected.map((message) => message.info.id)).toEqual([
      'target-user', 'process', 'final', 'turn-target-turn-completed', 'next-user',
    ])
  })

  it('turns 路由不可用时仍返回已经可读的普通会话正文', async () => {
    const engine = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/session/degraded/message') {
        res.statusCode = 200
        res.end(JSON.stringify([{ info: { id: 'm1', sessionID: 'degraded', role: 'assistant' }, parts: [{ type: 'text', text: '普通正文仍可读取' }] }]))
        return
      }
      if (req.url === '/session/degraded/turns') {
        req.socket.destroy()
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/degraded/messages`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([{ info: { id: 'm1', sessionID: 'degraded', role: 'assistant' }, parts: [{ type: 'text', text: '普通正文仍可读取' }] }])
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('消息为 204 时仍把 failed 终态投影为可见错误', async () => {
    const terminal = { turnID: 'empty-failed-turn', userMessageID: 'empty-user', state: 'failed', completedAt: Date.now(), error: { code: 'provider_timeout' } }
    const engine = createServer((req, res) => {
      if (req.url === '/session/empty-failed/message') { res.statusCode = 204; res.end(); return }
      if (req.url === '/session/empty-failed/turns') {
        res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([terminal])); return
      }
      res.statusCode = 404; res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer(); await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/empty-failed/messages`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([expect.objectContaining({
        info: expect.objectContaining({ kind: 'error', turnID: 'empty-failed-turn' }),
      })])
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('completed 终态和消息快照短暂不同步时重读成对快照并返回 assistant', async () => {
    let messageReads = 0
    const terminal = { turnID: 'projection-turn', userMessageID: 'projection-user', state: 'completed', completedAt: Date.now() }
    const engine = createServer((req, res) => {
      const send = (body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
      if (req.method === 'GET' && req.url === '/session/projection-session/turns') { send([terminal]); return }
      if (req.method === 'GET' && req.url === '/session/projection-session/message') {
        messageReads += 1
        const messages = [{ info: { id: 'projection-user', role: 'user' }, parts: [{ type: 'text', text: '等待投影' }] }]
        if (messageReads >= 2) messages.push({ info: { id: 'projection-assistant', role: 'assistant', turnID: 'projection-turn' }, parts: [{ type: 'text', text: '投影完成' }] })
        send(messages)
        return
      }
      res.statusCode = 404; res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/projection-session/messages`)
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(messageReads).toBe(2)
      expect(body).toEqual(expect.arrayContaining([
        expect.objectContaining({ info: expect.objectContaining({ id: 'projection-assistant', role: 'assistant' }) }),
      ]))
      expect(body).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ info: expect.objectContaining({ kind: 'error', turnID: 'projection-turn' }) }),
      ]))
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('历史 completed 终态永久缺少 assistant 时不重复等待并稳定返回诊断正文', async () => {
    let messageReads = 0
    const terminal = { turnID: 'missing-turn', userMessageID: 'missing-user', state: 'completed', completedAt: 20 }
    const engine = createServer((req, res) => {
      const send = (body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
      if (req.method === 'GET' && req.url === '/session/missing-session/turns') { send([terminal]); return }
      if (req.method === 'GET' && req.url === '/session/missing-session/message') {
        messageReads += 1
        send([{ info: { id: 'missing-user', role: 'user' }, parts: [{ type: 'text', text: '没有回复' }] }])
        return
      }
      res.statusCode = 404; res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/missing-session/messages`)
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(messageReads).toBe(1)
      expect(body).toEqual(expect.arrayContaining([
        expect.objectContaining({
          info: expect.objectContaining({ kind: 'error', turnID: 'missing-turn' }),
          parts: [{ type: 'text', text: '本轮已结束，但未收到智能体的有效回复，请重新发送。' }],
        }),
      ]))
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('completed 宽限期内不生成临时失败，正文出现后正常完成', () => {
    const terminal = { turnID: 'slow-turn', userMessageID: 'slow-user', state: 'completed', completedAt: Date.now() - 2000 }
    const user = { info: { id: 'slow-user', role: 'user' }, parts: [{ type: 'text', text: '长难句请求' }] }
    const waiting = mergeOfficeConversationTurns([user], [terminal], 'slow-session')
    expect(waiting).toEqual([user])
    expect(waiting).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ info: expect.objectContaining({ kind: 'error', turnID: 'slow-turn' }) }),
    ]))

    const completed = mergeOfficeConversationTurns([
      user,
      { info: { id: 'slow-assistant', role: 'assistant', turnID: 'slow-turn' }, parts: [{ type: 'text', text: '完整长回复' }] },
    ], [terminal], 'slow-session')
    expect(completed).toEqual(expect.arrayContaining([
      expect.objectContaining({ info: expect.objectContaining({ kind: 'completed', turnID: 'slow-turn' }) }),
    ]))
  })

  it('允许先创建空会话，再由对话编辑器发送首条消息', async () => {
    const calls = []
    const engine = createServer((req, res) => {
      calls.push({ method: req.method, url: req.url })
      req.resume()
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json')
        if (req.url === '/session' && req.method === 'POST') { res.statusCode = 201; res.end(JSON.stringify({ id: 'empty-1', title: '命名会话', provider: 'openai', model: 'gpt-4o' })); return }
        res.statusCode = 404; res.end('{}')
      })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    const previousDefaultProvider = process.env.OPENPAW_DEFAULT_PROVIDER
    delete process.env.OPENPAW_DEFAULT_PROVIDER
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '命名会话' }) })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ promptAccepted: false, session: { id: 'empty-1', title: '命名会话', provider: 'openai', model: 'gpt-4o' } })
      expect(calls.map((call) => call.url)).toEqual(['/session'])
    } finally {
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      if (previousDefaultProvider === undefined) delete process.env.OPENPAW_DEFAULT_PROVIDER
      else process.env.OPENPAW_DEFAULT_PROVIDER = previousDefaultProvider
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve))
    }
  })

  it('创建任务时写入安全的 goals frontmatter 并避免覆盖已有文件', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-task-create-'))
    const home = path.join(root, 'home')
    const previousHome = process.env.OPENPAW_HOME
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    const engine = createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 503; res.end('{}') }) })
    await listenOnFetchSafePort(engine)
    const address = engine.address()
    if (!address || typeof address === 'string') throw new Error('测试引擎未开放 TCP 端口')
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(address.port)}`
    try {
      const first = await createTask({ id: '../越界', objective: '整理会议', priority: 'high', nextAction: '读取文档', successCriteria: '包含结论、负责人和截止时间', executionMode: 'quick' })
      expect(first.id).toBe('越界')
      expect(first).toMatchObject({ successCriteria: '包含结论、负责人和截止时间', executionMode: 'quick', phase: 'planning', attempt: 1 })
      const second = await createTask({ id: 'same', objective: '第二项' })
      const third = await createTask({ id: 'same', objective: '第三项' })
      expect(second.id).toBe('same'); expect(third.id).toBe('same-2')
      expect(third.status).toBe('queued')
      expect(first.assignedAgent).toBe('周理')
      const text = await readFile(path.join(home, 'goals', 'same-2.md'), 'utf8')
      expect(text).toContain('created_at:')
      expect(parseFrontmatter(text).data).toMatchObject({ objective: '第三项', status: 'queued', phase: 'planning', success_criteria: '完成目标并给出可核验结果', execution_mode: 'auto_plan', next_action: '等待智能体接手' })
      await expect(createTask({ objective: '' })).rejects.toMatchObject({ code: 'invalid_request' })
    } finally {
      await resetGatewayState()
      if (previousHome === undefined) delete process.env.OPENPAW_HOME
      else process.env.OPENPAW_HOME = previousHome
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL
      else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => engine.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('技能正文路径固定在 skills 根目录内', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-skill-root-'))
    const home = path.join(root, 'home')
    await mkdir(path.join(home, 'skills', 'demo'), { recursive: true })
    await mkdir(path.join(home, 'secret'), { recursive: true })
    await writeFile(path.join(home, 'skills', 'demo', 'SKILL.md'), '# demo')
    await writeFile(path.join(home, 'secret', 'SKILL.md'), '# secret')
    const previousHome = process.env.OPENPAW_HOME; process.env.OPENPAW_HOME = home
    try {
      const gateway = await import('../scripts/action-gateway.mjs')
      await expect(gateway.readSkillFile('skills/demo/SKILL.md')).resolves.toMatchObject({ path: 'skills/demo/SKILL.md' })
      await expect(gateway.readSkillFile('skills/../secret/SKILL.md')).rejects.toMatchObject({ code: 'forbidden' })
    } finally { if (previousHome === undefined) delete process.env.OPENPAW_HOME; else process.env.OPENPAW_HOME = previousHome; await rm(root, { recursive: true, force: true }) }
  })

  it('提供通知和工作区接口', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-command-'))
    const home = path.join(root, 'home'); const workspace = path.join(root, 'workspace')
    await mkdir(home, { recursive: true }); await mkdir(workspace, { recursive: true })
    const previousHome = process.env.OPENPAW_HOME; const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    process.env.OPENPAW_HOME = home; process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    const server = createGatewayServer(); await listenOnFetchSafePort(server)
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('网关未开放 TCP 端口')
    const origin = `http://127.0.0.1:${String(address.port)}`
    try {
      const notifications = await (await fetch(`${origin}/office/notifications`)).json(); expect(notifications[0].read).toBe(false)
      const createdNotification = await fetch(`${origin}/office/notifications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新提醒', body: '已创建', level: 'success' }) })
      expect(createdNotification.status).toBe(201); expect((await createdNotification.json()).title).toBe('新提醒')
      const read = await fetch(`${origin}/office/notifications/${notifications[0].id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      expect(read.status).toBe(200); expect((await read.json()).read).toBe(true)
      expect(await (await fetch(`${origin}/office/workspace`)).json()).toEqual({ root: path.resolve(workspace) })
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME; else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE; else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true })
    }
  })

  it('任务取消、重新执行和生命周期通知保持一致', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-task-lifecycle-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await mkdir(home, { recursive: true }); await mkdir(workspace, { recursive: true })
    const sessions = new Map(); const promptBodies = []; let sequence = 0
    const engine = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const send = (status, body = null) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(body == null ? '' : JSON.stringify(body)) }
      if (req.method === 'POST' && url.pathname === '/session') {
        const id = `task-session-${++sequence}`
        sessions.set(id, { active: false, complete: false, hold: sequence === 1, failed: sequence === 3, turnID: `turn-${sequence}`, outcome: null })
        req.resume(); req.on('end', () => send(201, { id, title: '任务会话', provider: 'echo', model: 'echo-1' })); return
      }
      const match = url.pathname.match(/^\/session\/([^/]+)\/(prompt_async|abort|message|turns)$/)
      if (match) {
        const item = sessions.get(decodeURIComponent(match[1])); if (!item) { req.resume(); req.on('end', () => send(404, { error: 'not found' })); return }
        if (match[2] === 'prompt_async' && req.method === 'POST') {
          const chunks = []
          req.on('data', (chunk) => chunks.push(chunk))
          req.on('end', () => {
            promptBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            item.active = true
            if (!item.hold) setTimeout(() => {
              item.active = false; item.complete = true
              item.outcome = { turnID: item.turnID, userMessageID: `user-${item.turnID}`, state: item.failed ? 'failed' : 'completed', completedAt: Date.now(), ...(item.failed ? { error: { code: 'provider_timeout', retryable: true } } : {}) }
            }, 60)
            send(204)
          })
          return
        }
        if (match[2] === 'abort' && req.method === 'POST') { item.active = false; item.complete = true; item.outcome = { turnID: item.turnID, userMessageID: `user-${item.turnID}`, state: 'cancelled', completedAt: Date.now(), error: { code: 'cancelled', retryable: false } }; req.resume(); req.on('end', () => send(204)); return }
        if (match[2] === 'message' && req.method === 'GET') { req.resume(); req.on('end', () => send(200, item.complete ? [
          { info: { id: `user-${item.turnID}`, role: 'user' }, parts: [{ type: 'text', text: '执行任务' }] },
          { info: { id: `assistant-${item.turnID}`, role: 'assistant', turnID: item.turnID, time: { completed: Date.now() } }, parts: [{ type: 'text', text: '任务执行完成' }] },
        ] : [])); return }
        if (match[2] === 'turns' && req.method === 'GET') { req.resume(); req.on('end', () => send(200, item.outcome ? [item.outcome] : [])); return }
      }
      if (req.method === 'GET' && url.pathname === '/session/status') { send(200, Object.fromEntries([...sessions].filter(([, item]) => item.active).map(([id, item]) => [id, { type: 'busy', turnID: item.turnID }]))); return }
      send(404, { error: 'not found' })
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer()
    await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previousHome = process.env.OPENPAW_HOME; const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE; const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL; const previousProvider = process.env.OPENPAW_DEFAULT_PROVIDER
    process.env.OPENPAW_HOME = home; process.env.OPENPAW_OFFICE_WORKSPACE = workspace; process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(engineAddress.port)}`; process.env.OPENPAW_DEFAULT_PROVIDER = 'echo'
    const origin = `http://127.0.0.1:${String(gatewayAddress.port)}`
    const waitTask = async (id, predicate, timeout = 15_000) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const response = await fetch(`${origin}/office/tasks`); const list = await response.json(); const task = list.find((item) => item.id === id)
        if (task && predicate(task)) return task
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error(`任务 ${id} 未达到预期状态`)
    }
    try {
      const created = await fetch(`${origin}/office/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'cancel-me', objective: '取消慢任务', successCriteria: '任务可被中止且保留执行记录', executionMode: 'quick' }) })
      expect(created.status).toBe(201)
      await waitTask('cancel-me', (task) => task.status === 'in_progress' && Boolean(task.sessionId))
      expect(promptBodies[0].parts[0].text).toContain('你正在执行一个独立目标任务，不是普通对话。')
      expect(promptBodies[0].parts[0].text).toContain('完成标准：任务可被中止且保留执行记录')
      expect(promptBodies[0].parts[0].text).toContain('执行模式：快速执行')
      expect(promptBodies[0].parts[0].text).toContain('不要输出隐藏思维链')
      expect((await fetch(`${origin}/office/tasks/cancel-me`, { method: 'DELETE' })).status).toBe(409)
      const cancelled = await fetch(`${origin}/office/tasks/cancel-me/cancel`, { method: 'POST', body: '{}' })
      expect(cancelled.status).toBe(200); expect(await cancelled.json()).toMatchObject({ id: 'cancel-me', status: 'cancelled', nextAction: '任务已取消，可重新执行' })
      await waitTask('cancel-me', (task) => task.status === 'cancelled')
      const retry = await fetch(`${origin}/office/tasks/cancel-me/retry`, { method: 'POST', body: '{}' })
      expect(retry.status).toBe(200); const retryTask = await retry.json(); expect(retryTask).toMatchObject({ id: 'cancel-me-retry', status: 'queued', successCriteria: '任务可被中止且保留执行记录', executionMode: 'quick', attempt: 2, parentTaskId: 'cancel-me' })
      const finished = await waitTask('cancel-me-retry', (task) => task.status === 'completed')
      expect(finished.nextAction).toBe('已完成，等待复核')
      const notifications = await (await fetch(`${origin}/office/notifications`)).json()
      expect(notifications.some((item) => item.title === '任务已取消')).toBe(true)
      expect(notifications.some((item) => item.title === '任务已完成')).toBe(true)
      expect((await fetch(`${origin}/office/tasks/cancel-me/cancel`, { method: 'POST', body: '{}' })).status).toBe(409)
      expect((await fetch(`${origin}/office/tasks/cancel-me`, { method: 'DELETE' })).status).toBe(409)
      expect((await fetch(`${origin}/office/tasks/cancel-me-retry`, { method: 'DELETE' })).status).toBe(204)
      expect((await (await fetch(`${origin}/office/tasks`)).json()).some((item) => item.id === 'cancel-me-retry')).toBe(false)
      expect((await fetch(`${origin}/office/tasks/cancel-me`, { method: 'DELETE' })).status).toBe(204)
      expect((await (await fetch(`${origin}/office/tasks`)).json()).some((item) => item.id === 'cancel-me')).toBe(false)
      expect((await fetch(`${process.env.OPENPAW_ENGINE_HOST_URL}/session/${encodeURIComponent(finished.sessionId)}/message`)).status).toBe(200)
      expect((await fetch(`${origin}/office/tasks/missing`, { method: 'DELETE' })).status).toBe(404)
      expect((await fetch(`${origin}/office/tasks/bad%2Fid`, { method: 'DELETE' })).status).toBe(400)

      const failedWithText = await fetch(`${origin}/office/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'failed-with-text', objective: '验证失败终态' }) })
      expect(failedWithText.status).toBe(201)
      const failedTask = await waitTask('failed-with-text', (task) => task.status === 'failed')
      expect(failedTask.nextAction).toContain('provider_timeout')
      expect(failedTask).toMatchObject({ failureStage: 'executing', errorCode: 'provider_timeout', retryable: true, recommendedAction: '检查服务状态后重新执行' })
      expect(listAgents().every((agent) => agent.state === 'idle')).toBe(true)
      expect((await (await fetch(`${origin}/office/notifications`)).json()).some((item) => item.title === '任务执行失败')).toBe(true)
      expect((await fetch(`${origin}/office/tasks/failed-with-text`, { method: 'DELETE' })).status).toBe(204)
    } finally {
      if (previousHome === undefined) delete process.env.OPENPAW_HOME; else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE; else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL; else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      if (previousProvider === undefined) delete process.env.OPENPAW_DEFAULT_PROVIDER; else process.env.OPENPAW_DEFAULT_PROVIDER = previousProvider
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve)); await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('自动规划任务在持续产生进度时不会被无活动期限误杀', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-task-progress-'))
    const home = path.join(root, 'home'); const workspace = path.join(root, 'workspace')
    await mkdir(home, { recursive: true }); await mkdir(workspace, { recursive: true })
    let active = false; let startedAt = 0; let terminal = null
    const engine = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const send = (status, body = null) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(body == null ? '' : JSON.stringify(body)) }
      if (req.method === 'POST' && url.pathname === '/session') { req.resume(); req.on('end', () => send(201, { id: 'progress-session', provider: 'echo', model: 'echo-1' })); return }
      if (req.method === 'POST' && url.pathname === '/session/progress-session/prompt_async') {
        active = true; startedAt = Date.now()
        res.setHeader('openpaw-turn-id', 'progress-turn')
        req.resume(); req.on('end', () => {
          send(204)
          setTimeout(() => { active = false; terminal = { turnID: 'progress-turn', userMessageID: 'progress-user', state: 'completed', completedAt: Date.now() } }, 1800)
        }); return
      }
      if (req.method === 'GET' && url.pathname === '/session/status') {
        send(200, active ? { 'progress-session': { type: 'busy', turnID: 'progress-turn', activity: { revision: Math.floor((Date.now() - startedAt) / 300) } } } : {}); return
      }
      if (req.method === 'GET' && url.pathname === '/session/progress-session/turns') { send(200, terminal ? [terminal] : []); return }
      if (req.method === 'GET' && url.pathname === '/session/progress-session/message') {
        send(200, terminal ? [
          { info: { id: 'progress-user', role: 'user' }, parts: [{ type: 'text', text: '执行复杂任务' }] },
          { info: { id: 'progress-assistant', role: 'assistant', turnID: 'progress-turn' }, parts: [{ type: 'text', text: '复杂任务已完成' }] },
        ] : []); return
      }
      send(404, {})
    })
    await listenOnFetchSafePort(engine)
    const address = engine.address(); if (!address || typeof address === 'string') throw new Error('测试引擎未开放 TCP 端口')
    const previous = Object.fromEntries(['OPENPAW_HOME', 'OPENPAW_OFFICE_WORKSPACE', 'OPENPAW_ENGINE_HOST_URL', 'OPENPAW_DEFAULT_PROVIDER', 'OPENPAW_TASK_AUTO_PLAN_TIMEOUT_MS', 'OPENPAW_TASK_INACTIVITY_TIMEOUT_MS'].map((key) => [key, process.env[key]]))
    Object.assign(process.env, {
      OPENPAW_HOME: home,
      OPENPAW_OFFICE_WORKSPACE: workspace,
      OPENPAW_ENGINE_HOST_URL: `http://127.0.0.1:${String(address.port)}`,
      OPENPAW_DEFAULT_PROVIDER: 'echo',
      OPENPAW_TASK_AUTO_PLAN_TIMEOUT_MS: '5000',
      OPENPAW_TASK_INACTIVITY_TIMEOUT_MS: '1000',
    })
    try {
      await createTask({ id: 'progress-task', objective: '验证持续进度', executionMode: 'auto_plan' })
      const deadline = Date.now() + 5000
      let task
      while (Date.now() < deadline) {
        task = (await listTasks()).find((item) => item.id === 'progress-task')
        if (task?.status === 'completed' || task?.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(task).toMatchObject({ status: 'completed', nextAction: '已完成，等待复核' })
    } finally {
      await resetGatewayState()
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
      await new Promise((resolve) => engine.close(resolve)); await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

  it('超时失败任务在关联对话明确继续后收敛为完成', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-task-resume-'))
    const home = path.join(root, 'home'); const workspace = path.join(root, 'workspace')
    await mkdir(path.join(home, 'goals'), { recursive: true }); await mkdir(workspace, { recursive: true })
    await writeFile(path.join(home, 'goals', 'resume-task.md'), `---\nobjective: 继续复杂任务\nstatus: failed\nphase: failed\npriority: normal\nnext_action: 回合执行失败（provider_timeout），可重新执行\nfailure_reason: 回合执行失败（provider_timeout），可重新执行\nfailure_stage: executing\nerror_code: provider_timeout\nretryable: true\nexecution_mode: auto_plan\nsession_id: resume-session\nturn_id: failed-turn\ncreated_at: 2026-09-29T00:00:00.000Z\nupdated_at: 2026-09-29T00:02:00.000Z\n---\n`)
    let active = false; let terminal = null
    const engine = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const send = (status, body = null) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(body == null ? '' : JSON.stringify(body)) }
      if (req.method === 'POST' && url.pathname === '/session/resume-session/prompt_async') {
        active = true; res.setHeader('openpaw-turn-id', 'resume-turn')
        req.resume(); req.on('end', () => { send(204); setTimeout(() => { active = false; terminal = { turnID: 'resume-turn', userMessageID: 'resume-user', state: 'completed', completedAt: Date.now() } }, 80) }); return
      }
      if (req.method === 'GET' && url.pathname === '/session/status') { send(200, active ? { 'resume-session': { type: 'busy', turnID: 'resume-turn' } } : {}); return }
      if (req.method === 'GET' && url.pathname === '/session/resume-session/turns') { send(200, terminal ? [terminal] : []); return }
      if (req.method === 'GET' && url.pathname === '/session/resume-session/message') {
        send(200, terminal ? [
          { info: { id: 'resume-user', role: 'user' }, parts: [{ type: 'text', text: '继续' }] },
          { info: { id: 'resume-assistant', role: 'assistant', turnID: 'resume-turn' }, parts: [{ type: 'text', text: '任务继续执行并完成' }] },
        ] : []); return
      }
      send(404, {})
    })
    await listenOnFetchSafePort(engine)
    const gateway = createGatewayServer(); await listenOnFetchSafePort(gateway)
    const engineAddress = engine.address(); const gatewayAddress = gateway.address()
    if (!engineAddress || typeof engineAddress === 'string' || !gatewayAddress || typeof gatewayAddress === 'string') throw new Error('测试服务未开放 TCP 端口')
    const previous = Object.fromEntries(['OPENPAW_HOME', 'OPENPAW_OFFICE_WORKSPACE', 'OPENPAW_ENGINE_HOST_URL'].map((key) => [key, process.env[key]]))
    Object.assign(process.env, { OPENPAW_HOME: home, OPENPAW_OFFICE_WORKSPACE: workspace, OPENPAW_ENGINE_HOST_URL: `http://127.0.0.1:${String(engineAddress.port)}` })
    try {
      const response = await fetch(`http://127.0.0.1:${String(gatewayAddress.port)}/office/conversations/resume-session/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '继续执行；请复用已有结果', requestID: 'resume-request' }) })
      expect(response.status).toBe(202)
      const deadline = Date.now() + 5000
      let task
      while (Date.now() < deadline) {
        task = (await listTasks()).find((item) => item.id === 'resume-task')
        if (task?.status === 'completed') break
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      expect(task).toMatchObject({ status: 'completed', nextAction: '继续执行后已完成，等待复核', turnId: 'resume-turn' })
    } finally {
      await resetGatewayState()
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
      await new Promise((resolve) => gateway.close(resolve)); await new Promise((resolve) => engine.close(resolve)); await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

  it('completed 终态先于 assistant 消息快照可见时仍最终收敛为 completed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-task-completed-race-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await mkdir(home, { recursive: true }); await mkdir(workspace, { recursive: true })
    let messageReads = 0
    let active = false
    let terminal = null
    const engine = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const send = (status, body = null) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(body == null ? '' : JSON.stringify(body)) }
      if (req.method === 'POST' && url.pathname === '/session') {
        req.resume(); req.on('end', () => send(201, { id: 'race-session', title: '竞态会话', provider: 'echo', model: 'echo-1' })); return
      }
      if (req.method === 'POST' && url.pathname === '/session/race-session/prompt_async') {
        active = true
        setTimeout(() => {
          active = false
          terminal = { turnID: 'race-turn', userMessageID: 'race-user', state: 'completed', completedAt: Date.now() }
        }, 20)
        req.resume(); req.on('end', () => send(204)); return
      }
      if (req.method === 'GET' && url.pathname === '/session/status') {
        send(200, active ? { 'race-session': { type: 'busy', turnID: 'race-turn' } } : {}); return
      }
      if (req.method === 'GET' && url.pathname === '/session/race-session/turns') {
        send(200, terminal ? [terminal] : []); return
      }
      if (req.method === 'GET' && url.pathname === '/session/race-session/message') {
        messageReads += 1
        const messages = [{ info: { id: 'race-user', role: 'user' }, parts: [{ type: 'text', text: '执行竞态测试' }] }]
        if (messageReads > 1) messages.push({ info: { id: 'race-assistant', role: 'assistant', turnID: 'race-turn' }, parts: [{ type: 'text', text: '已完成' }] })
        send(200, messages); return
      }
      send(404, {})
    })
    await listenOnFetchSafePort(engine)
    const address = engine.address()
    if (!address || typeof address === 'string') throw new Error('测试引擎未开放 TCP 端口')
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    const previousProvider = process.env.OPENPAW_DEFAULT_PROVIDER
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(address.port)}`
    process.env.OPENPAW_DEFAULT_PROVIDER = 'echo'
    try {
      const created = await createTask({ id: 'completed-race', objective: '验证终态和消息快照竞态' })
      expect(created.status).toBe('queued')
      const deadline = Date.now() + 5_000
      let task
      while (Date.now() < deadline) {
        task = (await listTasks()).find((item) => item.id === 'completed-race')
        if (task?.status === 'completed' || task?.status === 'failed') break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(task).toMatchObject({ status: 'completed', nextAction: '已完成，等待复核' })
      expect(messageReads).toBeGreaterThanOrEqual(2)
    } finally {
      await resetGatewayState()
      if (previousHome === undefined) delete process.env.OPENPAW_HOME; else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE; else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL; else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      if (previousProvider === undefined) delete process.env.OPENPAW_DEFAULT_PROVIDER; else process.env.OPENPAW_DEFAULT_PROVIDER = previousProvider
      await new Promise((resolve) => engine.close(resolve)); await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

  it('Gateway 重启后按持久化 turn_id 收敛孤儿任务且不采用无关历史终态', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-task-recovery-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await mkdir(path.join(home, 'goals'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(path.join(home, 'goals', 'recover-me.md'), `---
objective: 恢复重启任务
status: in_progress
priority: high
next_action: 等待智能体返回结果
assigned_agent: 王明
session_id: recovered-session
turn_id: target-failed-turn
---
`)
    const engine = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET' && req.url === '/session/status') {
        res.statusCode = 200
        res.end('{}')
        return
      }
      if (req.method === 'GET' && req.url === '/session/recovered-session/turns') {
        res.statusCode = 200
        res.end(JSON.stringify([
          { turnID: 'target-failed-turn', state: 'failed', completedAt: 10, error: { code: 'provider_timeout', retryable: true } },
          { turnID: 'unrelated-completed-turn', state: 'completed', completedAt: 20 },
        ]))
        return
      }
      if (req.method === 'GET' && req.url === '/session/recovered-session/message') {
        res.statusCode = 200
        res.end(JSON.stringify([{ info: { role: 'assistant' }, parts: [{ type: 'text', text: '旧回合已有回复' }] }]))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const address = engine.address()
    if (!address || typeof address === 'string') throw new Error('测试引擎未开放 TCP 端口')
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(address.port)}`
    const gateway = createGatewayServer({ autoRecover: true })
    try {
      expect(await listTasks()).toEqual([expect.objectContaining({
        id: 'recover-me', status: 'in_progress', sessionId: 'recovered-session', turnId: 'target-failed-turn',
      })])
      await listenOnFetchSafePort(gateway)
      const deadline = Date.now() + 5_000
      let recovered
      while (Date.now() < deadline) {
        const parsed = parseFrontmatter(await readFile(path.join(home, 'goals', 'recover-me.md'), 'utf8')).data
        if (parsed.status === 'failed') { recovered = parsed; break }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(recovered).toMatchObject({
        status: 'failed', turn_id: 'target-failed-turn', next_action: '回合执行失败（provider_timeout），可重新执行',
      })
      expect(listAgents().every((agent) => agent.state === 'idle')).toBe(true)
    } finally {
      await resetGatewayState()
      if (previousHome === undefined) delete process.env.OPENPAW_HOME; else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE; else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL; else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve))
      await new Promise((resolve) => engine.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('Gateway listening 后主动且幂等恢复任务，普通列表读取没有恢复副作用', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ai-office-startup-recovery-'))
    const home = path.join(root, 'home')
    const workspace = path.join(root, 'workspace')
    await mkdir(path.join(home, 'goals'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(path.join(home, 'goals', 'startup.md'), `---
objective: 启动主动恢复
status: in_progress
priority: high
next_action: 等待智能体返回结果
assigned_agent: 王明
session_id: startup-session
turn_id: startup-turn
---
`)
    let hostRequests = 0
    const engine = createServer((req, res) => {
      hostRequests += 1
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'GET' && req.url === '/session/status') { res.end('{}'); return }
      if (req.method === 'GET' && req.url === '/session/startup-session/turns') {
        res.end(JSON.stringify([{ turnID: 'startup-turn', userMessageID: 'startup-user', state: 'completed', completedAt: 20 }]))
        return
      }
      if (req.method === 'GET' && req.url === '/session/startup-session/message') {
        res.end(JSON.stringify([
          { info: { id: 'history-user', role: 'user' }, parts: [{ type: 'text', text: '旧问题' }] },
          { info: { id: 'history-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '旧回复不能计入当前回合' }] },
          { info: { id: 'startup-user', role: 'user' }, parts: [{ type: 'text', text: '启动恢复问题' }] },
          { info: { id: 'startup-assistant', role: 'assistant', turnID: 'startup-turn' }, parts: [{ type: 'text', text: '启动恢复回复' }] },
        ]))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await listenOnFetchSafePort(engine)
    const address = engine.address()
    if (!address || typeof address === 'string') throw new Error('测试引擎未开放 TCP 端口')
    const previousHome = process.env.OPENPAW_HOME
    const previousWorkspace = process.env.OPENPAW_OFFICE_WORKSPACE
    const previousEngine = process.env.OPENPAW_ENGINE_HOST_URL
    process.env.OPENPAW_HOME = home
    process.env.OPENPAW_OFFICE_WORKSPACE = workspace
    process.env.OPENPAW_ENGINE_HOST_URL = `http://127.0.0.1:${String(address.port)}`
    const gateway = createGatewayServer({ autoRecover: true })
    try {
      expect(await listTasks()).toEqual([expect.objectContaining({ id: 'startup', status: 'in_progress' })])
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(hostRequests).toBe(0)

      await listenOnFetchSafePort(gateway)
      await Promise.all([startPersistedTaskRecovery(), startPersistedTaskRecovery()])
      const deadline = Date.now() + 2_000
      let recovered
      while (Date.now() < deadline) {
        recovered = parseFrontmatter(await readFile(path.join(home, 'goals', 'startup.md'), 'utf8')).data
        if (recovered.status === 'completed') break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(recovered, `Host 请求数：${hostRequests}`).toMatchObject({ status: 'completed', turn_id: 'startup-turn', next_action: '已完成，等待复核' })
      expect(hostRequests).toBe(3)
    } finally {
      await resetGatewayState()
      if (previousHome === undefined) delete process.env.OPENPAW_HOME; else process.env.OPENPAW_HOME = previousHome
      if (previousWorkspace === undefined) delete process.env.OPENPAW_OFFICE_WORKSPACE; else process.env.OPENPAW_OFFICE_WORKSPACE = previousWorkspace
      if (previousEngine === undefined) delete process.env.OPENPAW_ENGINE_HOST_URL; else process.env.OPENPAW_ENGINE_HOST_URL = previousEngine
      await new Promise((resolve) => gateway.close(resolve))
      await new Promise((resolve) => engine.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  })
})
