/** Local editorial case data. These fields are rendered into the existing result protocol. */
export type EditorialDraft = {
  platform: string
  format: '图文笔记' | '公众号文章' | '头条文章' | '微头条' | '知乎回答' | '百家号文章' | '图文作品'
  title: string
  body: string
  pages: readonly { title: string; copy: string; visual: string }[]
  tags: readonly string[]
  sourceIds: readonly string[]
  slot: string
  review: string
  followUp: string
}

export type EditorialPlan = {
  account: string
  audience: string
  angle: string
  sources: readonly { id: string; title: string; detail: string }[]
  drafts: readonly EditorialDraft[]
  retrospective?: {
    source: string
    window: string
    rows: readonly { platform: string; title: string; reading: string; saves: number; comments: number }[]
    conclusion: string
  }
}

export const editorialPageCount = (plan: EditorialPlan) => plan.drafts.reduce((total, draft) => total + draft.pages.length, 0)

export function editorialDraftMarkdown(draft: EditorialDraft) {
  return [
    `# ${draft.title}`, `平台：${draft.platform} · ${draft.format} · 待审核`,
    '## 正文', draft.body,
    ...(draft.pages.length ? ['## 配图分镜（待制作与审图）', draft.pages.map((page, index) =>
      `### 第 ${index + 1} 页｜${page.title}\n\n上图文字：${page.copy}\n\n画面要求：${page.visual}`).join('\n\n')] : []),
    ...(draft.tags.length ? ['## 话题', draft.tags.map(tag => `#${tag}`).join(' ')] : []),
    '## 编辑交接', `- 撰稿：陈书；资料核对：刘市；排期登记：赵审；终审：王明。\n- 拟发布时间：${draft.slot}，终审通过后由运营执行。\n- 审核意见：${draft.review}\n- 资料编号：${draft.sourceIds.join('、')}。\n- 发布回执：尚未发布，链接与实际时间待回填。\n- 回访：${draft.followUp}`,
  ].join('\n\n')
}

export function editorialRetrospectiveMarkdown(plan: EditorialPlan) {
  const review = plan.retrospective
  if (!review) return '本轮稿件尚未发布，没有本轮阅读、收藏或涨粉数据。发布后按实际链接记录 24 小时与 72 小时数据；各平台分别复盘，不把曝光、阅读和播放相加。'
  return [
    `来源：${review.source}。观察口径：${review.window}。以下为已归档旧内容，不是本轮待发稿的成绩。`,
    '| 平台 | 旧内容 | 平台阅读口径 | 收藏 | 评论 |', '| --- | --- | --- | --- | --- |',
    ...review.rows.map(row => `| ${row.platform} | ${row.title} | ${row.reading} | ${row.saves} | ${row.comments} |`),
    review.conclusion,
  ].join('\n\n')
}

export function editorialBriefMarkdown(plan: EditorialPlan, title: string, summary: string, next: string) {
  return [
    `# ${title}`, '## 本轮交付', summary,
    `## 账号与读者\n\n账号：${plan.account}\n\n读者：${plan.audience}\n\n选题角度：${plan.angle}`,
    '## 稿件安排', ...plan.drafts.map(draft => `- ${draft.platform}｜${draft.format}《${draft.title}》：${draft.pages.length ? `${draft.pages.length} 页配图分镜` : '纯文字'}；${draft.slot}（拟）；待审核。`),
    '## 资料与证据', ...plan.sources.map(source => `- **${source.id}｜${source.title}** ${source.detail}`),
    '## 审核交接', ...plan.drafts.map(draft => `- **${draft.platform}** ${draft.review}`),
    '## 数据与复盘', editorialRetrospectiveMarkdown(plan),
    '## 下一步', next,
  ].join('\n\n')
}

export function editorialScheduleCsv(plan: EditorialPlan) {
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
  const rows = plan.drafts.map(draft => [plan.account, draft.platform, draft.format, draft.title,
    String(draft.pages.length), '陈书', '王明', draft.slot, '待审核', draft.review,
    draft.sourceIds.map(id => `${id} ${plan.sources.find(source => source.id === id)?.title ?? ''}`).join('；'), '未发布', '', draft.followUp])
  return ['账号,平台,形式,标题,配图分镜页数,撰稿,终审,拟发布时间,审核状态,待办,资料来源,发布状态,发布链接,回访口径',
    ...rows.map(row => row.map(quote).join(','))].join('\n')
}

export function editorialReply(plan: EditorialPlan, question: string): string | undefined {
  if (/定位|受众|账号是谁|做什么账号/.test(question)) return `**${plan.account}**\n\n${plan.audience}\n\n本轮角度：${plan.angle}。`
  if (/发布数据|阅读量|收藏量|涨粉|数据口径|旧内容数据/.test(question)) return editorialRetrospectiveMarkdown(plan)
  if (/排期|几点发|什么时候发|谁来审核|审核意见/.test(question)) {
    return '**发布排期 · 尚未发布**\n\n' + plan.drafts.map(draft => `- **${draft.platform} · ${draft.slot}（拟）**《${draft.title}》。${draft.review}`).join('\n')
      + '\n\n陈书交稿，刘市核对资料，王明终审；通过后赵审再登记实际链接与时间。排期是本账号本轮安排，不是平台通用的最佳发布时间。'
  }
  const draftRequest = /正文|文案|完整.*稿|稿件|标题|配图|分镜|每页|图上写|文章怎么写/.test(question)
  if (!draftRequest) return
  const aliases: Record<string, string[]> = {
    '微信公众号': ['公众号', '微信'], '今日头条': ['头条'], '小红书': ['小红书'],
    '知乎': ['知乎'], '百家号': ['百家号', '百度'], '抖音': ['抖音'],
  }
  const mentioned = Object.entries(aliases).filter(([, names]) => names.some(name => question.includes(name))).map(([platform]) => platform)
  const drafts = plan.drafts.filter(draft => mentioned.includes(draft.platform))
  if (mentioned.length && !drafts.length) return `本轮没有安排${mentioned.join('、')}稿件。本轮在做${plan.drafts.map(draft => draft.platform).join('、')}，可以直接问我其中一个平台的正文或配图分镜。`
  const selected = drafts.length ? drafts : [plan.drafts[0]]
  if (/配图|分镜|每页|图上写/.test(question)) return selected.map(draft => `**${draft.platform}《${draft.title}》· 配图分镜**\n\n`
    + (draft.pages.length ? draft.pages.map((page, index) => `${index + 1}. **${page.title}**\n   上图文字：${page.copy}\n   画面：${page.visual}`).join('\n\n') : '这条是纯文字稿，不安排配图。')
    + '\n\n以上是制图说明，图片需制作并审图后才能发布。').join('\n\n')
  return selected.map(draft => `**${draft.platform} · ${draft.format} · 正文草稿**\n\n### ${draft.title}\n\n${draft.body}\n\n${draft.tags.map(tag => `#${tag}`).join(' ')}\n\n**待审核**\n\n${draft.review}`).join('\n\n')
}
