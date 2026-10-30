import Fastify from 'fastify'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chatOperationSchema } from '@pawoffice/protocol/chat'
import { ecommerceScenario, ecommerceResult, ecommerceConcept } from './ecommerce-scenario.mjs'
import { ecommerceAgents } from './ecommerce-presentation.mjs'
import { createEcommerceAttachments } from './ecommerce-preview-attachments.mjs'

/** Independent simulated business backend. All versions and chat history live in memory. */
export function createWorkflowMock({ baseUrl = 'http://127.0.0.1:8765', apiKey = 'pawoffice-demo-key', scenario = 'engineering', mode = 'interactive', round = 5 } = {}) {
  const app = Fastify(), histories = new Map(), streams = new Set(), jobs = new Set()
  const office = { schemaVersion: '1.0', seq: 1, workspace: { id: `workflow-${Date.now()}`, name: '全流程联调办公室' }, conversations: [
    { id: 'main', title: '从对话到多轮交付', whiteboard: { status: 'queued', result: {}, deliveries: [] } },
    { id: 'other', title: '会话隔离测试', whiteboard: { status: 'queued', result: {}, deliveries: [] } },
  ] }
  if (scenario === 'ecommerce') {
    office.workspace.name = `${ecommerceScenario.officeName} · ${mode === 'showcase' ? `全景第${round}轮` : '逐轮演示'}`
    office.conversations[0].title = ecommerceScenario.conversationTitle
    office.conversations[0].employees = structuredClone(ecommerceAgents)
    office.conversations[0].whiteboard.title = '青禾桌面 · 折叠支架上市项目'
    office.conversations[0].whiteboard.description = '完成14天上市准备、内容制作、预算安排和首轮经营复盘；实测参数与外部执行由商家确认。'
  }
  let mockUrl = ''
  const deliverySnapshots = new Map(), versionBodies = new Map()
  app.get('/assets/ecommerce-listing-concept.svg', (_, reply) => reply.header('Access-Control-Allow-Origin', '*').type('image/svg+xml').send(ecommerceConcept))
  app.get('/versions/:id', (request, reply) => {
    const version = versionBodies.get(request.params.id)
    reply.header('Access-Control-Allow-Origin', '*')
    return version ? reply.type(version.mimeType).send(version.content) : reply.code(404).send('版本不存在')
  })
  app.get('/deliveries/:id', (request, reply) => {
    const snapshot = deliverySnapshots.get(request.params.id)
    reply.header('Access-Control-Allow-Origin', '*')
    return snapshot ?? reply.code(404).send({ error: '交付不存在' })
  })
  function wireOffice() {
    if (scenario !== 'ecommerce') return structuredClone(office)
    const snapshot = structuredClone(office)
    const externalize = artifact => {
      if (!artifact.content) return artifact
      versionBodies.set(artifact.versionId, { content: artifact.content, mimeType: artifact.mimeType })
      return { ...artifact, content: '', url: `${mockUrl}/versions/${artifact.versionId}` }
    }
    for (const conversation of snapshot.conversations) {
      if (conversation.whiteboard.result.artifacts) conversation.whiteboard.result.artifacts = conversation.whiteboard.result.artifacts.map(externalize)
      conversation.whiteboard.deliveries = conversation.whiteboard.deliveries.map(delivery => {
        delivery.result.artifacts = delivery.result.artifacts.map(externalize)
        deliverySnapshots.set(delivery.id, delivery)
        return { id: delivery.id, turnId: delivery.turnId, sequence: delivery.sequence, title: delivery.title, createdAt: delivery.createdAt, snapshotUrl: `${mockUrl}/deliveries/${delivery.id}` }
      })
    }
    return snapshot
  }
  const post = async body => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/pawoffice/messages`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    const data = await response.json()
    if (![200, 202].includes(response.status)) throw new Error(`PawOffice HTTP ${response.status}: ${JSON.stringify(data)}`)
    return data
  }
  let publishing = Promise.resolve()
  const publish = () => {
    office.seq++
    const snapshot = wireOffice()
    const next = publishing.then(() => post({ type: 'office.snapshot', teamId: office.workspace.id, snapshot }))
    publishing = next.catch(() => {})
    return next
  }
  const artifact = (id, versionId, title, content, runId, mimeType = 'text/markdown') => ({ id, versionId, title, content, runId, mimeType,
    version: versionId.endsWith('v2') ? 'v2' : 'v1', sha256: createHash('sha256').update(content).digest('hex'), producedAt: new Date().toISOString() })
  function applyEcommerce(turn, conversation, number) {
    const board = conversation.whiteboard, id = `${conversation.id}-delivery-${number}`
    const delivery = ecommerceResult(number, board, id, artifact)
    Object.assign(board, delivery.board, { result: { ...delivery.result, artifacts: delivery.current } })
    const { result: _result, deliveries: _deliveries, ...historicalBoard } = board
    board.deliveries.push({ id, turnId: turn.id, sequence: number, title: delivery.title, createdAt: delivery.result.producedAt,
      result: structuredClone(delivery.result), board: structuredClone(historicalBoard) })
    conversation.tasks = delivery.dashboardTasks
    conversation.events ??= []
    conversation.events.push({ id: `event-${number}`, kind: 'note', summary: delivery.result.summary, occurredAt: delivery.result.producedAt, employeeId: 'office-lead' })
    turn.assistant = delivery.reply; turn.state = 'complete'
    return delivery
  }
  const emit = (turn, event) => { for (const send of turn.listeners) send(event) }
  async function generate(turn, conversation, number) {
    try {
      if (scenario === 'ecommerce' && conversation.id === 'attachments') {
        turn.assistant = '此会话是固定的成果预览附件。请点击“当前成果”查看代码、CSV与JSON，五轮业务对话请切回“79元折叠支架上市准备”。'
        turn.state = 'complete'
        emit(turn, { type: 'snapshot', text: turn.assistant, state: 'complete', message: '' })
        return
      }
      if (scenario === 'ecommerce' && number > ecommerceScenario.rounds.length) {
        turn.assistant = '本案例五轮已完成，请查看当前成果，或从原消息、文件版本菜单回看旧版。'
        turn.state = 'complete'
        emit(turn, { type: 'snapshot', text: turn.assistant, state: 'complete', message: '' })
        return
      }
      conversation.whiteboard.status = 'running'
      await publish()
      await new Promise(resolve => setTimeout(resolve, 250))
      if (turn.state !== 'pending') return
      const board = conversation.whiteboard, id = `${conversation.id}-delivery-${number}`
      const previous = board.result.artifacts ?? []
      if (scenario === 'ecommerce') {
        const delivery = applyEcommerce(turn, conversation, number)
        await publish()
        turn.assistant = delivery.reply; turn.state = 'complete'
        emit(turn, { type: 'snapshot', text: turn.assistant, state: 'complete', message: '' })
        return
      }
      let current = previous.map(item => ({ ...item, change: 'unchanged' })), items = [], checks = [], status = 'ready'
      let summary = '已确认目标，下一轮输入任意消息，生成首版文件。'
      if (number === 2) {
        current = [artifact('requirements', 'requirements-v1', '需求说明.md', '# 需求说明\n\n- 账号登录\n- 退出登录\n', id), artifact('api', 'api-v1', '接口约定.json', '{"login":"POST /api/login"}\n', id, 'application/json')].map(item => ({ ...item, change: 'added' }))
        items = current; summary = '首次交付：新增需求说明 v1 和接口约定 v1。'
      } else if (number === 3) {
        const doc = artifact('requirements', 'requirements-v2', '需求说明.md', '# 需求说明\n\n- 账号登录\n- 退出登录\n- 连续失败五次限制请求\n', id)
        const report = artifact('report', 'report-v1', '复核报告.md', '# 复核报告\n\n旧检查只验证需求 v1，需求 v2 需要重新验证。\n', id)
        items = [{ ...doc, change: 'updated' }, { ...report, change: 'added' }]
        current = [items[0], ...current.filter(item => item.id !== 'requirements'), items[1]]
        checks = [{ id: 'scope', label: '需求范围检查', status: 'passed', artifactId: 'requirements', versionId: 'requirements-v1' }]
        status = 'verified'; summary = '更新需求为 v2，新增复核报告，接口沿用 v1。特意保留旧版检查，页面应提示验证待核对。'
      } else if (number === 4) {
        const old = board.deliveries[1].result.artifacts.find(item => item.id === 'requirements')
        items = [{ ...old, change: 'updated' }]; current = [items[0], ...current.filter(item => item.id !== old.id)]
        summary = '已回滚采用需求 v1；历史 v2 仍保留。当前采用版本不等于最新创建版本。'
      } else if (number === 5) {
        items = current.filter(item => item.id === 'api').map(item => ({ ...item, change: 'removed' }))
        current = current.filter(item => item.id !== 'api'); summary = '从当前集合移除接口约定；第五轮保留移除记录，第二轮原文件仍可下载。'
      } else if (number >= 6) {
        checks = [{ id: 'scope', label: '当前需求范围检查', status: 'passed', artifactId: 'requirements', versionId: current.find(item => item.id === 'requirements')?.versionId ?? '' }]
        items = current.map(item => ({ ...item, change: 'unchanged' }))
        status = 'verified'; summary = '针对当前采用的需求版本重新验证，验收通过。'
      }
      const result = { runId: id, title: '多轮交付演示', status: number === 1 ? 'draft' : status, summary, artifacts: items, checks, producedAt: new Date().toISOString() }
      board.deliveries.push({ id, turnId: turn.id, sequence: number, title: `第 ${number} 轮交付`, createdAt: result.producedAt, result: structuredClone(result) })
      board.result = { ...result, artifacts: current }
      board.status = number >= 6 ? 'completed' : 'running'
      await publish()
      turn.assistant = summary; turn.state = 'complete'
      emit(turn, { type: 'snapshot', text: summary, state: 'complete', message: '' })
    } catch (error) { turn.state = 'error'; turn.error = error.message; emit(turn, { type: 'error', message: error.message }) }
  }
  app.post('/chat', async (request, reply) => {
    const input = chatOperationSchema.parse(request.body)
    const conversation = office.conversations.find(item => item.id === input.conversationId)
    if (input.teamId !== office.workspace.id || !conversation) return reply.code(404).send({ code: 404, msg: '此 mock 仅服务本次全流程联调办公室', data: {} })
    const turns = histories.get(input.conversationId) ?? []; histories.set(input.conversationId, turns)
    const view = ({ id, user, assistant, state, error }) => ({ id, user, assistant, state, error })
    if (input.type === 'history') {
      const end = input.cursor ? turns.findIndex(item => item.id === input.cursor) : turns.length
      if (end < 0) return reply.code(400).send({ code: 400, msg: '无效游标', data: {} })
      const start = Math.max(0, end - input.limit), selected = turns.slice(start, end)
      return { code: 200, msg: 'OK', data: { turns: selected.map(view), hasMore: start > 0, nextCursor: start > 0 ? turns[start].id : '', activeTurnId: selected.find(item => item.state === 'pending')?.id ?? '' } }
    }
    let turn = turns.find(item => item.id === input.turnId)
    if (input.type === 'cancel') { if (turn?.state === 'pending') { turn.state = 'stopped'; emit(turn, { type: 'snapshot', text: turn.assistant, state: 'stopped', message: '' }) } return { code: 200, msg: 'OK', data: { stopped: true } } }
    if (!turn && input.type === 'send') {
      if (turns.some(item => item.state === 'pending')) return reply.code(409).send({ code: 409, msg: '上一轮仍在执行', data: {} })
      turn = { id: input.turnId, user: input.messages.at(-1)?.content ?? '', assistant: '', state: 'pending', error: '', listeners: new Set() }
      turns.push(turn)
      const job = generate(turn, conversation, turns.length); jobs.add(job); job.finally(() => jobs.delete(job))
    }
    if (!turn) return reply.code(404).send({ code: 404, msg: '轮次不存在', data: {} })
    if (input.type === 'send' && turn.user !== input.messages.at(-1)?.content) return reply.code(409).send({ code: 409, msg: '轮次内容冲突', data: {} })
    reply.hijack(); const stream = reply.raw; streams.add(stream)
    stream.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' })
    const send = event => { if (!stream.destroyed && !stream.writableEnded) { stream.write(JSON.stringify(event) + '\n'); if (event.type === 'error' || event.type === 'snapshot' && event.state !== 'pending') stream.end() } }
    turn.listeners.add(send); stream.once('close', () => { streams.delete(stream); turn.listeners.delete(send) })
    send({ type: 'snapshot', text: turn.assistant, state: turn.state, message: turn.error })
    return reply
  })
  app.addHook('preClose', async () => { for (const stream of streams) stream.destroy(); await Promise.allSettled(jobs) })
  return { app, office, initialize: async url => {
    mockUrl = url
    if (scenario === 'ecommerce' && !office.conversations.some(item => item.id === 'attachments')) office.conversations.push(createEcommerceAttachments(artifact))
    if (mode === 'showcase') {
      if (scenario !== 'ecommerce' || !Number.isInteger(round) || round < 1 || round > 5) throw new Error('完整状态模式仅支持电商案例的1–5轮。')
      if (!histories.has('main')) {
        const turns = []
        for (let number = 1; number <= round; number++) {
          const turn = { id: `showcase-main-turn-${number}`, user: ecommerceScenario.rounds[number - 1].prompt, assistant: '', state: 'pending', error: '', listeners: new Set() }
          applyEcommerce(turn, office.conversations[0], number)
          turns.push(turn)
        }
        histories.set('main', turns)
      }
    }
    return post({ type: 'offices.initialize', offices: [wireOffice()], chat: { url: `${url}/chat` } })
  } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scenario = process.env.PAWOFFICE_MOCK_SCENARIO ?? 'ecommerce'
  const mode = process.env.PAWOFFICE_MOCK_MODE ?? 'interactive'
  const mock = createWorkflowMock({ baseUrl: process.env.PAWOFFICE_URL, apiKey: process.env.PAWOFFICE_API_KEY, scenario, mode, round: Number(process.env.PAWOFFICE_MOCK_ROUND ?? 5) })
  try {
    const url = await mock.app.listen({ host: '127.0.0.1', port: Number(process.env.PAWOFFICE_MOCK_PORT ?? 8799) })
    await mock.initialize(url)
    if (scenario === 'ecommerce') {
      console.log(`电商 mock 已就绪：选择“${mock.office.workspace.name}”→“79元折叠支架上市准备”。`)
      console.log(mode === 'showcase' ? `已载入第${process.env.PAWOFFICE_MOCK_ROUND ?? 5}轮完整页面及之前的聊天、交付和文件版本。直接打开“当前成果”即可评审。` : '从空会话开始；每次发送后推进一轮。')
      for (const [index, round] of ecommerceScenario.rounds.entries()) console.log(`\n第 ${index + 1} 轮 · ${round.title}\n${round.prompt}`)
      console.log('\n完整 prompt、回复和文件正文见 integration/docs/ecommerce-workflow.md。')
      console.log('另有“成果预览 · 代码 / CSV / JSON”会话，打开“当前成果”查看代码高亮、CSV分页和JSON版本树。')
    } else {
      console.log('选择“全流程联调办公室”→“从对话到多轮交付”：1 确认目标 → 2 首次交付 → 3 更新 → 4 回滚 → 5 移除 → 6 验收。')
    }
    console.log('这是内存模拟后端；本次会注册实例级聊天地址。其他办公室的真实聊天请在结束后由原业务后端重新注册。Ctrl+C 停止。')
    process.once('SIGINT', async () => { await mock.app.close(); process.exit(0) })
  } catch (error) { console.error(error.message); await mock.app.close(); process.exitCode = 1 }
}
