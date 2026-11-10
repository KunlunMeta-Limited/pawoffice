import type { DashboardConversation } from '@pawoffice/protocol/dashboard'
import type { ChatRequest } from '@pawoffice/protocol/chat'
import type { SceneRuntime } from '@pawoffice/runtime/SceneRuntime'
import { CommerceSceneQueue } from '../application/CommerceSceneQueue.ts'
import { createOfficeDataSource } from '../dashboard/createSource.ts'
import { DemoOfficeDirectory } from '../dashboard/demoOfficeDirectory.ts'
import { ExampleOfficeDataSource } from '../dashboard/demoSource.ts'
import { OfficeDemoSource } from '../dashboard/OfficeDemoSource.ts'
import type { OfficeTeamDefinition } from '../dashboard/officeDirectory.ts'
import { dashboardWhiteboardTaskBoard } from '../dashboard/whiteboard.ts'
import { demoDialogues, matchesDemoKeyword, normalizeDemoQuestion } from './demoDialogue.ts'
import type { DemoReplyPool, DemoScenarioId } from './demoDialogue.ts'

type ScenarioStep = { title: string; role: string; summary: string }
type Scenario = {
  id: DemoScenarioId
  name: string
  conversationTitle: string
  steps: readonly [ScenarioStep, ScenarioStep, ScenarioStep]
}

const scenarios: readonly Scenario[] = [
  {
    id: 'office-demo-seo',
    name: 'SEO优化办公室',
    conversationTitle: '产品页 SEO 检查',
    steps: [
      { title: '检查页面标题与描述', role: '页面审查', summary: '检查产品页的标题、描述与主标题。' },
      { title: '整理关键词与内链', role: '关键词分析', summary: '按搜索意图整理关键词与页面间的链接。' },
      { title: '输出优化清单', role: '优化方案', summary: '按影响范围排序并整理改动草稿。' },
    ],
  },
  {
    id: 'office-demo-tax',
    name: '报税办公室',
    conversationTitle: '本期申报资料整理',
    steps: [
      { title: '归集本期发票', role: '票据归集', summary: '按日期和来源整理本期发票。' },
      { title: '核对收支与凭证', role: '凭证核对', summary: '对照收支记录，标出待补凭证。' },
      { title: '整理申报草稿', role: '申报资料', summary: '汇总已核对资料和待确认项目。' },
    ],
  },
  {
    id: 'office-demo-social',
    name: '自媒体运营办公室',
    conversationTitle: '一周内容排期',
    steps: [
      { title: '梳理受众与选题', role: '选题策划', summary: '从评论中整理受众感兴趣的话题。' },
      { title: '起草短视频和图文', role: '内容制作', summary: '为技巧视频与案例图文拟定提纲。' },
      { title: '整理发布排期', role: '运营排期', summary: '安排发布顺序与互动复盘时间。' },
    ],
  },
  {
    id: 'office-demo-collection',
    name: '信息采集办公室',
    conversationTitle: '公开资料采集与校验',
    steps: [
      { title: '整理待采集来源', role: '来源检索', summary: '汇总公告、公开网页和订阅条目。' },
      { title: '提取记录并去重', role: '信息提取', summary: '提取标题、日期和链接，合并重复记录。' },
      { title: '复核来源并归档', role: '来源校验', summary: '核对出处，单独标注来源待核实的记录。' },
    ],
  },
  {
    id: 'office-demo-digest',
    name: '多入口信息归纳办公室',
    conversationTitle: '跨入口项目简报',
    steps: [
      { title: '汇集邮件、群聊和表单', role: '入口汇集', summary: '按入口登记消息及其时间。' },
      { title: '合并同一事件', role: '事件归类', summary: '归并重复提及，标记不同入口的冲突。' },
      { title: '输出项目简报', role: '简报整理', summary: '将结论分为时间、变更与待确认事项。' },
    ],
  },
]

const assignees = ['code-agent', 'file-agent', 'app-agent'] as const
const ticksPerStep = 5
const tickDurationMs = 700
const handoffSpeechMs = 800
const startPhrases = ['开始', '开始处理', '开始执行', '开始演示', '重新演示', '重跑一遍']
const progressKeywords = ['进度', '做到哪', '处理到哪', '做完了', '完成了', '跑完了', '下一步', '还剩', '什么时候完成']
const resultKeywords = ['结果', '成果', '交付物', '总结', '完整清单', '完整报告', '项目简报']
const sampleKeywords = ['成果预览', '预览成果', '交付预览', '样例结果', '结果样例', '成果样例', '成果示例', '样例报告', '报告样例']
const helpLeads = ['可以问我', '如果想了解细节，可以问我', '想接着看具体做法的话，可以问我'] as const

export class ScenarioOfficeDataSource extends ExampleOfficeDataSource {
  readonly scenario: Scenario

  constructor(scenario: Scenario) {
    const roles = Object.fromEntries(scenario.steps.map((step, index) => [assignees[index], step.role]))
    super(new Date(), {
      workspace: { id: scenario.id, name: scenario.name },
      conversationTitle: scenario.conversationTitle,
      roles: { ...roles, 'review-agent': '成果复核', 'data-agent': '资料归档' },
      tasks: scenario.steps.map((step, index) => ({
        id: `scenario-step-${index + 1}`,
        title: step.title,
        summary: step.summary,
        assigneeId: assignees[index],
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
      const status = phase < 0 || !delivered.has(assignees[index]) ? 'queued' : progress === 100 ? 'completed' : 'running'
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
    this.replaceConversations([{ ...main, tasks, events: snapshot.events, whiteboard: dashboardWhiteboardTaskBoard(snapshot) }])
  }
}

/** Advance the local task walkthrough on the office's existing simulation clock. */
export class ScenarioDemoSource extends OfficeDemoSource {
  private readonly scene: SceneRuntime
  private readonly data: ScenarioOfficeDataSource
  private readonly handoffs: CommerceSceneQueue
  private readonly delivered = new Set<string>()
  private readonly lastReply = new WeakMap<DemoReplyPool, number>()
  private assigning = false
  private elapsedMs = 0
  private shownTick = 0

  constructor(scene: SceneRuntime, data: ScenarioOfficeDataSource) {
    super(scene, { automatic: false })
    this.scene = scene
    this.data = data
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

    this.assigning = true
    const stops = this.data.scenario.steps.map((step, index) => ({
      hostId: assignees[index],
      message: `请${step.title}。`,
      reply: '收到，我来处理。',
    }))
    this.handoffs.visit(stops, handoffSpeechMs, actorId => {
      this.delivered.add(actorId)
      this.data.showProgress(this.shownTick, this.delivered)
    }, () => { this.assigning = false })
  }

  private resetProgress() {
    this.assigning = false
    this.delivered.clear()
    this.elapsedMs = 0
    this.shownTick = 0
    this.data.showProgress(-1, this.delivered)
  }

  override tick(elapsedMs: number) {
    if (!this.isRunning || this.scene.isEditing) return
    const step = Math.floor(this.shownTick / ticksPerStep)
    const canAdvance = this.delivered.has(assignees[step])
    try {
      this.handoffs.tick()
    } catch (error) {
      this.handoffs.stop()
      this.resetProgress()
      this.fail(error instanceof Error ? error.message : '暂时无法完成任务交接')
      return
    }
    if (canAdvance) {
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

  reply(request: ChatRequest) {
    const last = request.messages.at(-1)
    const question = normalizeDemoQuestion(last?.role === 'user' ? last.content : '')
    const scenario = this.data.scenario
    const dialogue = demoDialogues[scenario.id]
    // Only an explicit command can start the workflow. Questions can mention the same words.
    const command = question.replace(/^(?:请|麻烦)(?:你|帮我)?/, '').replace(/(?:一下|吧)+$/, '')
    if ([...startPhrases, ...dialogue.startPhrases].some(phrase => phrase === command)) {
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
    if (matchesDemoKeyword(question, progressKeywords)) {
      answers.push(this.progressReply(this.data.getConversations()[0].tasks))
    }
    if (matchesDemoKeyword(question, sampleKeywords)) {
      answers.push(`下面是交付内容的预览。\n\n${this.pickReply(dialogue.results)}`)
    } else if (!topics.length && matchesDemoKeyword(question, resultKeywords)) {
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
    if (completed === tasks.length) return `已完成全部 ${tasks.length} 项任务。可以问我「结果是什么？」查看本轮交付内容。`
    if (running) {
      const nextStep = next ? `下一步是「${next.title}」。` : '这是最后一项。'
      return `已完成 ${completed}/${tasks.length} 项。正在「${running.title}」，本项进度 ${running.progress ?? 0}%。${nextStep}`
    }
    if (this.isDispatching && next) {
      return `已完成 ${completed}/${tasks.length} 项。王明正在交代「${next.title}」，等负责的同事确认后就开始处理。`
    }
    return `当前没有任务在运行，已完成 ${completed}/${tasks.length} 项。${next ? `下一项是「${next.title}」。` : ''} 你可以告诉我「开始处理」。`
  }
}

export function conferenceLocalOffices(storage?: Storage): readonly OfficeTeamDefinition[] {
  const existing = new DemoOfficeDirectory(createOfficeDataSource(), storage).list()
  return [
    ...existing,
    ...scenarios.map(scenario => ({
      id: scenario.id,
      name: scenario.name,
      sceneLabel: '办公室',
      source: new ScenarioOfficeDataSource(scenario),
    })),
  ]
}
