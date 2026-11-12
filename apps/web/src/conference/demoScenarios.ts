import type { DashboardConversation } from '@pawoffice/protocol/dashboard'
import type { ChatRequest } from '@pawoffice/protocol/chat'
import type { SceneRuntime } from '@pawoffice/runtime/SceneRuntime'
import { CommerceSceneQueue } from '../application/CommerceSceneQueue.ts'
import type { OfficeTeamSession } from '../application/OfficeTeamSession.ts'
import { createOfficeDataSource } from '../dashboard/createSource.ts'
import { DemoOfficeDirectory } from '../dashboard/demoOfficeDirectory.ts'
import { ExampleOfficeDataSource } from '../dashboard/demoSource.ts'
import { OfficeDemoSource } from '../dashboard/OfficeDemoSource.ts'
import type { OfficeTeamDefinition } from '../dashboard/officeDirectory.ts'
import { dashboardWhiteboardTaskBoard } from '../dashboard/whiteboard.ts'
import { demoDialogues, isDemoStartCommand, matchesDemoKeyword, normalizeDemoQuestion } from './demoDialogue.ts'
import type { DemoReplyPool, DemoScenarioId } from './demoDialogue.ts'
import { isDemoReportQuestion, scenarioDemoReport } from './demoReports.ts'
import { hasScenarioResult, scenarioResult } from './demoResults.ts'

type ScenarioStep = { title: string; role: string; summary: string; assigneeId: string }
type Scenario = {
  id: DemoScenarioId
  name: string
  conversationTitle: string
  /** One-sentence goal, shown as the board's 任务目标 on the result page. */
  goal: string
  steps: readonly [ScenarioStep, ScenarioStep, ScenarioStep]
  listingApproval?: { title: string; description: string }
}

const scenarios: readonly Scenario[] = [
  {
    id: 'office-1',
    name: '电商运营团队',
    conversationTitle: '折叠电脑支架上架准备',
    goal: '核对商品资料与页面，按 79 元完成上架准备与确认登记。',
    steps: [
      { title: '核对商品资料与售价', role: '商品运营', summary: '核对 79 元定价、六档调节与 13–16 英寸适用范围。', assigneeId: 'app-agent' },
      { title: '复核上架页面', role: '上架质检', summary: '检查标题、主图、详情页和尺寸说明是否一致。', assigneeId: 'file-agent' },
      { title: '记录上架确认结果', role: '发布登记', summary: '等待负责人确认后登记结果和后续观察事项。', assigneeId: 'data-agent' },
    ],
    listingApproval: {
      title: '确认按 79 元上架折叠电脑支架？',
      description: '商品资料与页面已复核。确认后将在本案例中记录上架，开始准备经营观察。',
    },
  },
  {
    id: 'office-content',
    name: '商品视觉团队',
    conversationTitle: '折叠电脑支架素材审核',
    goal: '整理主图、详情与尺寸说明，交付可审核的素材清单。',
    steps: [
      { title: '梳理主图拍摄要求', role: '视觉策划', summary: '明确展开状态、调节细节和折叠收纳的画面重点。', assigneeId: 'code-agent' },
      { title: '编排详情页与尺寸图', role: '详情设计', summary: '按使用场景、六档调节、折叠收纳和适用尺寸编排。', assigneeId: 'app-agent' },
      { title: '复核并交付图片清单', role: '素材校对', summary: '核对 13–16 英寸说明、图文一致性和移动端可读性。', assigneeId: 'file-agent' },
    ],
  },
  {
    id: 'office-analysis',
    name: '经营分析团队',
    conversationTitle: '折叠电脑支架转化复盘',
    goal: '对比两轮 24 小时经营数据，整理复盘建议与下一步动作。',
    steps: [
      { title: '核对两轮访问和订单', role: '数据核验', summary: '统一 24 小时口径，核对 360 次访问、9 单和 350 次访问、14 单。', assigneeId: 'data-agent' },
      { title: '分类尺寸与机型咨询', role: '咨询分析', summary: '归类首轮 10 条咨询，整理其中 6 条适配问题。', assigneeId: 'code-agent' },
      { title: '整理经营复盘建议', role: '策略复核', summary: '对比两轮成交率，提出保持价格并验证尺寸说明的建议。', assigneeId: 'review-agent' },
    ],
  },
  {
    id: 'office-demo-seo',
    name: 'SEO优化办公室',
    conversationTitle: '产品页 SEO 检查',
    goal: '检查产品页标题、描述与内链，输出可执行的优化清单。',
    steps: [
      { title: '检查页面标题与描述', role: '页面审查', summary: '检查产品页的标题、描述与主标题。', assigneeId: 'code-agent' },
      { title: '整理关键词与内链', role: '关键词分析', summary: '按搜索意图整理关键词与页面间的链接。', assigneeId: 'review-agent' },
      { title: '输出优化清单', role: '优化方案', summary: '按影响范围排序并整理改动草稿。', assigneeId: 'app-agent' },
    ],
  },
  {
    id: 'office-demo-tax',
    name: '报税办公室',
    conversationTitle: '本期申报资料整理',
    goal: '归集本期票据并核对收支凭证，交付待复核的申报草稿。',
    steps: [
      { title: '归集本期发票', role: '票据归集', summary: '按日期和来源整理本期发票。', assigneeId: 'data-agent' },
      { title: '核对收支与凭证', role: '凭证核对', summary: '对照收支记录，标出待补凭证。', assigneeId: 'file-agent' },
      { title: '整理申报草稿', role: '申报资料', summary: '汇总已核对资料和待确认项目。', assigneeId: 'review-agent' },
    ],
  },
  {
    id: 'office-demo-social',
    name: '自媒体运营办公室',
    conversationTitle: '一周内容排期',
    goal: '规划一周内容选题与发布节奏，形成可执行的排期。',
    steps: [
      { title: '梳理受众与选题', role: '选题策划', summary: '从评论中整理受众感兴趣的话题。', assigneeId: 'review-agent' },
      { title: '起草短视频和图文', role: '内容制作', summary: '为技巧视频与案例图文拟定提纲。', assigneeId: 'app-agent' },
      { title: '整理发布排期', role: '运营排期', summary: '安排发布顺序与互动复盘时间。', assigneeId: 'data-agent' },
    ],
  },
  {
    id: 'office-demo-collection',
    name: '信息采集办公室',
    conversationTitle: '公开资料采集与校验',
    goal: '采集公开资料、去重并核验来源，归档可追溯的记录。',
    steps: [
      { title: '整理待采集来源', role: '来源检索', summary: '汇总公告、公开网页和订阅条目。', assigneeId: 'code-agent' },
      { title: '提取记录并去重', role: '信息提取', summary: '提取标题、日期和链接，合并重复记录。', assigneeId: 'data-agent' },
      { title: '复核来源并归档', role: '来源校验', summary: '核对出处，单独标注来源待核实的记录。', assigneeId: 'file-agent' },
    ],
  },
  {
    id: 'office-demo-digest',
    name: '多入口信息归纳办公室',
    conversationTitle: '跨入口项目简报',
    goal: '汇总多个入口的项目消息，输出带待确认事项的简报。',
    steps: [
      { title: '汇集邮件、群聊和表单', role: '入口汇集', summary: '按入口登记消息及其时间。', assigneeId: 'file-agent' },
      { title: '合并同一事件', role: '事件归类', summary: '归并重复提及，标记不同入口的冲突。', assigneeId: 'review-agent' },
      { title: '输出项目简报', role: '简报整理', summary: '将结论分为时间、变更与待确认事项。', assigneeId: 'app-agent' },
    ],
  },
]

const ticksPerStep = 5
const tickDurationMs = 700
const handoffSpeechMs = 800
const progressKeywords = ['进度', '做到哪', '处理到哪', '做完了', '完成了', '跑完了', '下一步', '还剩', '什么时候完成']
const resultKeywords = ['结果', '成果', '交付物', '总结', '完整清单', '完整报告', '项目简报']
const sampleKeywords = ['成果预览', '预览成果', '交付预览', '样例结果', '结果样例', '成果样例', '成果示例', '样例报告', '报告样例']
const helpLeads = ['可以问我', '如果想了解细节，可以问我', '想接着看具体做法的话，可以问我'] as const

export class ScenarioOfficeDataSource extends ExampleOfficeDataSource {
  readonly scenario: Scenario

  constructor(scenario: Scenario) {
    const roles = Object.fromEntries(scenario.steps.map(step => [step.assigneeId, step.role]))
    super(new Date(), {
      workspace: { id: scenario.id, name: scenario.name },
      conversationTitle: scenario.conversationTitle,
      roles: { 'review-agent': '成果复核', 'data-agent': '资料归档', ...roles },
      tasks: scenario.steps.map((step, index) => ({
        id: `scenario-step-${index + 1}`,
        title: step.title,
        summary: step.summary,
        assigneeId: step.assigneeId,
        status: 'queued',
        progress: 0,
      })),
    })
    this.scenario = scenario
  }

  showProgress(tick: number, delivered: ReadonlySet<string>) {
    const [main] = this.getConversations()
    const at = new Date().toISOString()
    const events = tick < 0 ? main.events.filter(event => !event.id.startsWith('scenario-progress-')) : main.events
    const tasks: DashboardConversation['tasks'] = main.tasks.map((task, index) => {
      const phase = tick - index * ticksPerStep
      const progress = Math.max(0, Math.min(100, Math.floor(phase * 100 / ticksPerStep)))
      const awaitingApproval = this.scenario.listingApproval && index === this.scenario.steps.length - 1 && phase === 0
      const status = phase < 0 || awaitingApproval || !delivered.has(this.scenario.steps[index].assigneeId)
        ? 'queued' : progress === 100 ? 'completed' : 'running'
      if (status !== 'queued' && status !== task.status) {
        events.unshift({
          id: `scenario-progress-${crypto.randomUUID()}`,
          kind: status === 'running' ? 'task.started' : 'task.completed',
          taskId: task.id,
          employeeId: task.assigneeId,
          summary: `${status === 'running' ? '开始' : '完成'}「${task.title}」`,
          occurredAt: at,
        })
      }
      if (task.status === status && task.progress === progress) return task
      return { ...task, status, progress, updatedAt: at }
    })
    const snapshot = {
      schemaVersion: '1.0' as const,
      workspace: { id: this.scenario.id, name: this.scenario.name },
      employees: main.employees,
      tasks,
      events: events.slice(0, 100),
    }
    const board = { ...dashboardWhiteboardTaskBoard(snapshot), description: this.scenario.goal }
    // Only a finished walkthrough that really ends in a report carries a result; everything else
    // keeps the board-only state so the reader's empty fallback stays truthful.
    const finished = tasks.length > 0 && tasks.every(task => task.status === 'completed')
    const result = finished ? scenarioResult(this.scenario.id, new Date()) : undefined
    this.replaceConversations([{ ...main, tasks, events: snapshot.events, whiteboard: result ? { ...board, result } : board }])
  }
}

/** Advance the local task walkthrough on the office's existing simulation clock. */
export class ScenarioDemoSource extends OfficeDemoSource {
  private readonly scene: SceneRuntime
  private readonly data: ScenarioOfficeDataSource
  private readonly getSession: () => OfficeTeamSession
  private readonly handoffs: CommerceSceneQueue
  private readonly delivered = new Set<string>()
  private readonly lastReply = new WeakMap<DemoReplyPool, number>()
  private assigning = false
  private elapsedMs = 0
  private shownTick = 0
  private approval?: { id: string; choice?: string }

  constructor(scene: SceneRuntime, data: ScenarioOfficeDataSource, getSession: () => OfficeTeamSession) {
    super(scene, { automatic: false })
    this.scene = scene
    this.data = data
    this.getSession = getSession
    this.handoffs = new CommerceSceneQueue(scene)
  }

  get isDispatching() {
    return this.isRunning && this.assigning
  }

  override setEnabled(enabled: boolean) {
    if (enabled === this.isRunning) return
    if (!enabled) this.handoffs.stop()
    super.setEnabled(enabled)
    this.resetProgress()
    if (!enabled) return

    if (this.data.scenario.listingApproval) this.getSession().chat.restorePreviewConversation('main')
    this.assigning = true
    const stops = this.data.scenario.steps.map(step => ({
      hostId: step.assigneeId,
      message: `请${step.title}。`,
      reply: `收到，${step.role}交给我。`,
    }))
    this.handoffs.visit(stops, handoffSpeechMs, actorId => {
      this.delivered.add(actorId)
      this.data.showProgress(this.shownTick, this.delivered)
    }, () => { this.assigning = false })
  }

  private resetProgress() {
    if (this.approval) this.getSession().decisions.dismiss(this.approval.id)
    this.approval = undefined
    this.assigning = false
    this.delivered.clear()
    this.elapsedMs = 0
    this.shownTick = 0
    this.data.showProgress(-1, this.delivered)
  }

  override tick(elapsedMs: number) {
    if (!this.isRunning || this.scene.isEditing) return
    const step = Math.floor(this.shownTick / ticksPerStep)
    const assignee = this.data.scenario.steps[step]?.assigneeId
    const canAdvance = assignee !== undefined && this.delivered.has(assignee)
    try {
      this.handoffs.tick()
    } catch (error) {
      this.handoffs.stop()
      this.resetProgress()
      this.fail(error instanceof Error ? error.message : '暂时无法完成任务交接')
      return
    }
    if (canAdvance) {
      const { steps, listingApproval } = this.data.scenario
      if (listingApproval && step === steps.length - 1 && !this.checkListingApproval(listingApproval)) return
      // An acknowledgement starts the work clock on the following tick.
      const stepEnd = (step + 1) * ticksPerStep * tickDurationMs
      this.elapsedMs = Math.min(this.elapsedMs + elapsedMs, stepEnd)
      const tick = Math.floor(this.elapsedMs / tickDurationMs)
      if (tick !== this.shownTick) {
        this.shownTick = tick
        this.data.showProgress(tick, this.delivered)
      }
    }
    if (!this.assigning && this.shownTick >= this.data.scenario.steps.length * ticksPerStep) super.setEnabled(false)
  }

  private listingChoice() {
    const approval = this.approval
    if (!approval) return undefined
    return approval.choice ?? this.getSession().decisions.getSnapshot().records.find(record => record.request.id === approval.id)?.choiceId
  }

  private checkListingApproval(approval: NonNullable<Scenario['listingApproval']>) {
    const { chat, decisions } = this.getSession()
    const { ready, conversations } = chat.getSnapshot()
    if (!ready) return false
    if (!conversations.some(item => item.id === 'main')) {
      this.setEnabled(false)
      return false
    }
    if (this.approval) {
      const choice = this.listingChoice()
      this.approval.choice = choice
      if (choice === 'reject') {
        this.handoffs.stop()
        this.assigning = false
        super.setEnabled(false)
      }
      return choice === 'confirm'
    }
    const leader = this.scene.readActors().find(actor => actor.id === 'office-lead')
    const id = `listing-${crypto.randomUUID()}`
    if (decisions.enqueue({
      ...approval,
      id,
      teamId: this.scene.sceneId,
      conversationId: 'main',
      kind: 'confirmation',
      requester: { name: leader?.name ?? '办公室负责人', appearanceId: leader?.templateId ?? 'office-lead' },
      confirmLabel: '确认上架',
      rejectLabel: '暂不上架',
    })) {
      this.approval = { id }
    } else {
      this.setEnabled(false)
      this.fail('暂时无法提交上架确认')
    }
    return false
  }

  reply(request: ChatRequest) {
    const last = request.messages.at(-1)
    const question = normalizeDemoQuestion(last?.role === 'user' ? last.content : '')
    const scenario = this.data.scenario
    const dialogue = demoDialogues[scenario.id]
    // Only an explicit command can start the workflow. Questions can mention the same words.
    if (isDemoStartCommand(question, dialogue.startPhrases)) {
      if (this.isRunning) return this.progressReply(this.data.getConversations()[0].tasks)
      try {
        this.setEnabled(true)
      } catch (error) {
        return error instanceof Error ? error.message : '暂时无法开始处理，请稍后再试。'
      }
      return `已开始「${scenario.conversationTitle}」，王明正在逐项交代任务。先${scenario.steps[0].title}，再${scenario.steps[1].title}，最后${scenario.steps[2].title}。可以随时问我「现在进度如何？」`
    }

    const topics = dialogue.topics.filter(topic => matchesDemoKeyword(question, topic.keywords))
    const answers: string[] = []
    if (isDemoReportQuestion(question) || matchesDemoKeyword(question, sampleKeywords)) {
      const tasks = this.data.getConversations()[0].tasks
      let status = tasks.every(task => task.status === 'completed') ? '本轮完成' : this.isRunning ? '处理中' : '交付内容的预览'
      if (this.approval) {
        const choice = this.listingChoice()
        if (!choice) status = '待确认上架'
        else if (choice === 'reject') status = '暂不上架'
      }
      return scenarioDemoReport(scenario.id, status, this.progressReply(tasks))
    }
    if (matchesDemoKeyword(question, progressKeywords)) {
      answers.push(this.progressReply(this.data.getConversations()[0].tasks))
    }
    if (!topics.length && matchesDemoKeyword(question, resultKeywords)) {
      const tasks = this.data.getConversations()[0].tasks
      if (tasks.every(task => task.status === 'completed')) answers.push(this.pickReply(dialogue.results))
      else if (!answers.length) answers.push(`${this.progressReply(tasks)} 需要的话，我可以先给你看成果预览。`)
    }
    answers.push(...topics.map(topic => this.pickReply(topic.answers)))
    if (answers.length) return answers.join('\n\n')

    const examples = dialogue.topics.slice(0, 3).map(topic => `「${topic.question}」`).join('、')
    return `${dialogue.brief}\n\n${this.pickReply(helpLeads)}${examples}。准备好了就告诉我「开始处理」。`
  }

  private pickReply(pool: DemoReplyPool) {
    const previous = this.lastReply.get(pool)
    const choices = previous === undefined ? pool.length : pool.length - 1
    let index = Math.floor(Math.random() * choices)
    if (previous !== undefined && index >= previous) index++
    this.lastReply.set(pool, index)
    return pool[index]
  }

  private progressReply(tasks: DashboardConversation['tasks']) {
    const completed = tasks.filter(task => task.status === 'completed').length
    const running = tasks.find(task => task.status === 'running')
    const next = tasks.find(task => task.status === 'queued')
    if (this.approval) {
      const choice = this.listingChoice()
      if (!choice) return '商品资料与页面已复核，正在等待上架确认。确认后会登记本轮结果。'
      if (choice === 'reject') return '商品资料与页面已复核，本轮选择暂不上架。上架前可修改材料，再发起新一轮检查。'
    }
    if (completed === tasks.length) {
      return hasScenarioResult(this.data.scenario.id)
        ? `已完成全部 ${tasks.length} 项任务。本轮成果已生成，点工具栏「当前成果」查看。`
        : `已完成全部 ${tasks.length} 项任务。可以问我「结果是什么？」查看本轮交付内容。`
    }
    if (running) {
      const nextStep = next ? `下一步是「${next.title}」。` : '这是最后一项。'
      return `已完成 ${completed}/${tasks.length} 项。正在「${running.title}」，本项进度 ${running.progress ?? 0}%。${nextStep}`
    }
    if (this.isDispatching && next) {
      const leader = this.scene.readActors().find(actor => actor.id === 'office-lead')?.name ?? '负责人'
      return `已完成 ${completed}/${tasks.length} 项。${leader}正在交代「${next.title}」，等负责的同事确认后就开始处理。`
    }
    return `当前没有任务在运行，已完成 ${completed}/${tasks.length} 项。${next ? `下一项是「${next.title}」。` : ''} 你可以告诉我「开始处理」。`
  }
}

export function conferenceLocalOffices(storage?: Storage): readonly OfficeTeamDefinition[] {
  const saved = storage
    ? new DemoOfficeDirectory(createOfficeDataSource(), storage).list().filter(office => office.id.startsWith('office-local-'))
    : []
  return [
    ...scenarios.map(scenario => ({
      id: scenario.id,
      name: scenario.name,
      sceneLabel: '办公室',
      source: new ScenarioOfficeDataSource(scenario),
    })),
    ...saved,
  ]
}
