import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { createTestServer } from './helpers/vite.mjs'
import { maxDecisionCustomText } from '@pawoffice/protocol/office-integration'

let server, DecisionSession, createDecisionPreview, DecisionCard, OfficeDecisionPanel
before(async () => {
  server = await createTestServer()
  ;({ DecisionSession } = await server.ssrLoadModule('/apps/web/src/application/decisions/DecisionSession.ts'))
  ;({ createDecisionPreview } = await server.ssrLoadModule('/apps/web/src/application/decisions/preview.ts'))
  ;({ DecisionCard, OfficeDecisionPanel } = await server.ssrLoadModule('/apps/web/src/ui/decisions/OfficeDecisionPanel.tsx'))
})
after(() => server?.close())
const requester = { name: '王明', appearanceId: 'office-lead' }
const teamId = 'office-1'

test('decisions are queued and invalid or duplicate resolutions cannot advance them', t => {
  const requests = createDecisionPreview(teamId, requester), session = new DecisionSession(teamId, requests)
  t.after(() => session.clearReceipt())
  let changes = 0
  const unsubscribe = session.subscribe(() => { changes++ })
  const initial = session.getSnapshot()
  assert.equal(session.getSnapshot(), initial)
  assert.equal(session.resolve(teamId, requests[1].id, 'confirm'), null)
  assert.equal(session.resolve(teamId, requests[0].id, 'missing'), null)
  assert.equal(session.resolve('other-team', requests[0].id, 'information'), null)
  assert.equal(session.getSnapshot(), initial)
  const result = session.resolve(teamId, requests[0].id, 'coupon')
  assert.equal(result.label, '试用 5 元优惠')
  assert.equal(session.getSnapshot().pending[0].kind, 'confirmation')
  assert.equal(initial.pending.length, 2)
  assert.equal(session.resolve(teamId, requests[0].id, 'information'), null)
  assert.equal(changes, 1)
  assert.equal(session.resolve(teamId, requests[1].id, 'reject').label, '暂不上架')
  assert.equal(session.getSnapshot().pending.length, 0)
  assert.equal(session.getSnapshot().records.length, 2)
  assert.equal(session.resolve(teamId, requests[1].id, 'confirm'), null)
  unsubscribe(); session.reset()
  assert.equal(changes, 2)
  assert.equal(session.getSnapshot().pending.length, 2)
})

test('confirmation and rejection are distinct outcomes and teams never share decisions', t => {
  const requests = createDecisionPreview(teamId, requester)
  const a = new DecisionSession(teamId, requests), b = new DecisionSession('other-team', createDecisionPreview('other-team', requester))
  t.after(() => { a.clearReceipt(); b.clearReceipt() })
  a.resolve(teamId, requests[0].id, 'information')
  assert.equal(a.resolve(teamId, requests[1].id, 'confirm').choiceId, 'confirm')
  assert.equal(b.getSnapshot().pending.length, 2)
  a.clearRecords(); assert.equal(a.getSnapshot().records.length, 0)
  assert.equal(a.getSnapshot().pending.length, 0)
})

test('choice cards use radio options and cannot submit before selection', () => {
  const html = renderToStaticMarkup(createElement(DecisionCard, {
    request: createDecisionPreview(teamId, requester)[0], count: 2, preview: true, onResolve() {}, onCollapse() {},
  }))
  assert.equal((html.match(/type="radio"/g) ?? []).length, 4)
  assert.match(html, /disabled=""[^>]*>[^]*提交选择/)
  assert(html.includes('收起待决定面板'))
  assert(html.includes('本地演示'))
  assert(html.includes('另有 1 项待处理'))
})

test('confirmation cards expose both choices and completed queues show the receipt', t => {
  const requests = createDecisionPreview(teamId, requester)
  const html = renderToStaticMarkup(createElement(DecisionCard, { request: requests[1], count: 1, onResolve() {}, onCollapse() {} }))
  assert(html.includes('确认上架')); assert(html.includes('暂不上架'))
  assert(!html.includes('type="radio"'))
  const session = new DecisionSession(teamId, requests)
  t.after(() => session.clearReceipt())
  session.resolve(teamId, requests[0].id, 'information'); session.resolve(teamId, requests[1].id, 'confirm')
  const receipt = renderToStaticMarkup(createElement(OfficeDecisionPanel, { snapshot: session.getSnapshot(), preview: true, onResolve() {}, onReset() {} }))
  assert(receipt.includes('已记录：')); assert(!receipt.includes('查看记录')); assert(receipt.includes('重新演示'))
  const empty = renderToStaticMarkup(createElement(OfficeDecisionPanel, { snapshot: { teamId, pending: [], records: [], receipt: null }, onResolve() {}, onReset() {} }))
  assert.equal(empty, '')
})

test('timed decision cards place the visible countdown after their action buttons', () => {
  const createdAt = Date.now(), expiresAt = createdAt + 15000
  for (const request of createDecisionPreview(teamId, requester)) {
    const html = renderToStaticMarkup(createElement(DecisionCard, {
      request: { ...request, createdAt, expiresAt, deadline: undefined }, count: 1, onResolve() {}, onCollapse() {},
    }))
    assert(html.indexOf('office-decision-deadline') > html.indexOf('</footer>'))
    assert.match(html, /role="progressbar"[^>]*aria-label="选择剩余时间"/)
    assert.match(html, /aria-valuetext="15 秒"/)
  }
})

test('local preview deadlines are fresh on replay and expire without making a default choice', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 })
  const session = new DecisionSession(teamId, () => createDecisionPreview(teamId, requester))
  t.after(() => session.stop())
  session.start()
  const first = session.getSnapshot().pending[0]
  assert.equal(first.expiresAt - first.createdAt, 60000)
  const html = renderToStaticMarkup(createElement(DecisionCard, { request: first, count: 2, preview: true, onResolve() {}, onCollapse() {} }))
  assert.match(html, /aria-label="选择剩余时间"/)
  t.mock.timers.tick(10000)
  session.reset()
  assert.equal(session.getSnapshot().pending[0].expiresAt, first.expiresAt + 10000)
  t.mock.timers.tick(60001)
  assert.equal(session.getSnapshot().pending.length, 0)
  assert.equal(session.getSnapshot().records.length, 0)
  assert.equal(session.getSnapshot().receipt, null)
})

test('initial preview timers follow the session lifecycle instead of starting in an abandoned constructor', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const session = new DecisionSession(teamId, () => createDecisionPreview(teamId, requester))
  t.after(() => session.stop())
  t.mock.timers.tick(60001)
  assert.equal(session.getSnapshot().pending.length, 2)
  session.start(); session.stop()
  t.mock.timers.tick(60001)
  assert.equal(session.getSnapshot().pending.length, 2)
  session.start()
  t.mock.timers.tick(60001)
  assert.equal(session.getSnapshot().pending.length, 0)
})

test('local decision preview stays outside the public protocol and real connections', async () => {
  const workspace = await readFile(new URL('../apps/web/src/components/RuntimeWorkspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /decisionPreview=\{dataMode === 'example' && chatSession.source.kind === 'preview'\}/)
  const chat = await readFile(new URL('../apps/web/src/components/OfficeChat.tsx', import.meta.url), 'utf8')
  assert.match(chat, /<OfficeDecisionPanel preview=\{decisionPreview\} hidden=\{expanded\}/)
  assert(!chat.includes('new DecisionSession'))
  assert(!chat.includes('decisionSession.clearRecords'), 'starting a chat must not erase team decision history')
  const transcript = await readFile(new URL('../apps/web/src/components/ChatTranscript.tsx', import.meta.url), 'utf8')
  assert.match(transcript, /key=\{row.id\}/)
  const css = await readFile(new URL('../apps/web/src/components/OfficeChat.css', import.meta.url), 'utf8')
  assert.match(css, /\.office-chat\s*\{[^}]*overflow:\s*clip/)
  const panelCss = await readFile(new URL('../apps/web/src/ui/decisions/OfficeDecisionPanel.css', import.meta.url), 'utf8')
  assert.match(panelCss, /\.office-decision-card\s*\{[^}]*max-height:\s*100%/)
})

test('receipt expires without a mounted view and does not reappear when the team is reopened', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = createDecisionPreview(teamId, requester), session = new DecisionSession(teamId, requests)
  session.resolve(teamId, requests[0].id, 'information'); session.resolve(teamId, requests[1].id, 'confirm')
  assert.equal(session.getSnapshot().receipt.label, '确认上架')
  t.mock.timers.tick(3001)
  assert.equal(session.getSnapshot().receipt, null)
  assert.equal(session.getSnapshot().records.length, 2)
  const html = renderToStaticMarkup(createElement(OfficeDecisionPanel, { snapshot: session.getSnapshot(), onResolve() {}, onReset() {} }))
  assert.equal(html, '')
})

test('background arrivals are team-scoped and duplicate delivery never recreates a completed request', t => {
  const request = createDecisionPreview(teamId, requester)[1], session = new DecisionSession(teamId)
  t.after(() => session.clearReceipt())
  assert.equal(session.enqueue({ ...request, teamId: 'wrong-team' }), false)
  assert.equal(session.enqueue(request), true)
  assert.equal(session.enqueue(request), false)
  assert.equal(session.resolve('wrong-team', request.id, 'confirm'), null)
  session.resolve(teamId, request.id, 'confirm')
  assert.equal(session.enqueue(request), false)
  assert.equal(session.getSnapshot().pending.length, 0)
  assert.equal(session.getSnapshot().records[0].request.teamId, teamId)
})

test('a newly arrived request cancels the old receipt timer without touching its own queue', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const request = createDecisionPreview(teamId, requester)[1], session = new DecisionSession(teamId)
  session.enqueue(request); session.resolve(teamId, request.id, 'confirm')
  session.enqueue({ ...request, id: 'new-request' })
  t.mock.timers.tick(5000)
  assert.equal(session.getSnapshot().receipt, null)
  assert.equal(session.getSnapshot().pending[0].id, 'new-request')
  assert.equal(session.getSnapshot().records.length, 1)
})

test('custom choice text is trimmed, bounded and recorded without changing standard options', t => {
  const request = createDecisionPreview(teamId, requester)[0], session = new DecisionSession(teamId, [request])
  t.after(() => session.clearReceipt())
  assert.equal(session.resolve(teamId, request.id, 'custom'), null)
  assert.equal(session.resolve(teamId, request.id, 'custom', '   '), null)
  assert.equal(session.resolve(teamId, request.id, 'custom', 'x'.repeat(maxDecisionCustomText + 1)), null)
  assert.equal(session.resolve(teamId, request.id, 'missing', '夹带自由文本'), null)
  assert.equal(session.getSnapshot().pending.length, 1)
  const record = session.resolve(teamId, request.id, 'custom', '  需要补充导出能力  ')
  assert.equal(record.choiceId, 'custom')
  assert.equal(record.label, '需要补充导出能力')
  assert.equal(record.customText, '需要补充导出能力')
  assert.equal(session.getSnapshot().receipt?.label, '需要补充导出能力')
  assert.equal(session.getSnapshot().receipt?.customText, '需要补充导出能力')
})

test('allowCustom false rejects custom text while standard choices keep working', t => {
  const request = { ...createDecisionPreview(teamId, requester)[0], id: 'no-custom', allowCustom: false }
  const session = new DecisionSession(teamId, [request])
  t.after(() => session.clearReceipt())
  assert.equal(session.resolve(teamId, request.id, 'custom', '自定义需求'), null)
  assert.equal(session.resolve(teamId, request.id, 'information').label, '补充尺寸说明，保持 79 元')
})

test('remote custom choices submit trimmed text through the registered callback', async t => {
  const request = { teamId, id: 'remote-custom', kind: 'choice', allowCustom: true, requester, title: '选择处理方式', description: '',
    options: [{ id: 'one', label: '方案一', description: '' }, { id: 'two', label: '方案二', description: '' }] }
  const session = new DecisionSession(teamId), submitted = []
  t.after(() => session.clearReceipt())
  assert.equal(session.enqueue(request, async (choiceId, customText) => { submitted.push([choiceId, customText]) }), true)
  const record = await session.choose(teamId, request.id, 'custom', ' 新增导出能力 ')
  assert.deepEqual(submitted, [['custom', '新增导出能力']])
  assert.equal(record.label, '新增导出能力')
  assert.equal(record.customText, '新增导出能力')
})

test('omitted allowCustom allows custom text without a custom option', t => {
  const request = { teamId, id: 'default-custom', kind: 'choice', requester, title: '选择处理方式', description: '',
    options: [{ id: 'one', label: '方案一', description: '' }, { id: 'two', label: '方案二', description: '' }] }
  const session = new DecisionSession(teamId, [request])
  t.after(() => session.clearReceipt())
  assert.equal(session.resolve(teamId, request.id, 'custom', ' 自定义需求 ').customText, '自定义需求')
})

test('choice cards offer custom input as a radio option with the editor initially hidden', () => {
  const [choice, confirmation] = createDecisionPreview(teamId, requester)
  const render = request => renderToStaticMarkup(createElement(DecisionCard, { request, count: 1, onResolve() {}, onCollapse() {} }))
  const html = render(choice)
  assert.equal((html.match(/type="radio"/g) ?? []).length, 4)
  assert.match(html, /<label data-selected="false"><input type="radio"[^>]*value="custom"[^>]*><span><strong>其他需求<\/strong><small>填写你的具体需求<\/small><\/span><\/label>/)
  assert(!html.includes('class="office-decision-secondary"'))
  assert(!html.includes('<textarea'))
  assert(!html.includes('class="office-decision-custom"'))
  assert.match(html, /disabled=""[^>]*>[^]*提交选择/)
  assert(!render(confirmation).includes('<textarea'))
  assert(!render(confirmation).includes('其他需求'))
  const optedOut = { ...choice, allowCustom: false }
  assert(!render(optedOut).includes('<textarea'))
  assert(!render(optedOut).includes('其他需求'))
})
