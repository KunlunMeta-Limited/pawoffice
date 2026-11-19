import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, conferenceLocalOffices, renderCommerceMemberProfile, MemberOfficeShell, MemberProfilePresentation
before(async () => {
  server = await createTestServer()
  ;({ conferenceLocalOffices } = await server.ssrLoadModule('/apps/web/src/conference/demoScenarios.ts'))
  ;({ renderCommerceMemberProfile } = await server.ssrLoadModule('/apps/web/src/conference/CommerceMemberProfile.tsx'))
  ;({ MemberOfficeShell } = await server.ssrLoadModule('/apps/web/src/ui/MemberOfficeShell.tsx'))
  ;({ MemberProfilePresentation } = await server.ssrLoadModule('/apps/web/src/ui/memberProfilePresentation.ts'))
})
after(() => server?.close())

test('the three commerce portraits show distinct responsibilities without inventing tasks or changing other offices', async () => {
  const offices = conferenceLocalOffices()
  const dashboard = await offices[0].source.getSnapshot(), original = structuredClone(dashboard)
  for (const [employeeId, expected] of [['office-lead', '协作安排'], ['code-agent', '资料交接记录'], ['file-agent', '验收与交接要求']]) {
    const html = renderToStaticMarkup(createElement(MemberProfilePresentation.Provider, { value: renderCommerceMemberProfile },
      createElement(MemberOfficeShell, { dashboard, dataMode: 'example', selectedEmployeeId: employeeId,
        rosterActors: dashboard.employees.map(employee => ({ id: employee.sceneActorId, name: employee.name })),
        appearanceIds: {}, pendingTaskIds: [], executeAction: async () => {}, renderScenePanel: () => null })))
    const sidebar = html.split('class="member-detail-scroll"')[1].split('class="member-detail-footer"')[0]
    assert.match(sidebar, /本轮职责/)
    assert.match(sidebar, /当前跟进/)
    assert(sidebar.includes(expected))
    assert(!sidebar.includes('暂无动态'))
    assert(!sidebar.includes('当前没有关联任务'))
    assert.match(html, /data-expanded="true"/)
  }
  assert.deepEqual(dashboard, original)
  assert.equal(dashboard.tasks.length, 3)
  assert.equal(renderCommerceMemberProfile({ dashboard, employeeId: 'app-agent', expanded: false }), null)
  assert.equal(renderCommerceMemberProfile({ dashboard: await offices[1].source.getSnapshot(), employeeId: 'office-lead', expanded: false }), null)
  assert.equal(renderCommerceMemberProfile({ dashboard: { ...dashboard, conversationId: 'another-conversation' }, employeeId: 'office-lead', expanded: false }), null)
})

test('recording details reflect authorization and review progress before describing a completed delivery', async () => {
  const dashboard = await conferenceLocalOffices()[0].source.getSnapshot()
  const render = statuses => {
    const view = { ...dashboard, tasks: dashboard.tasks.map((task, index) => ({ ...task, status: statuses[index] })) }
    return renderToStaticMarkup(renderCommerceMemberProfile({ dashboard: view, employeeId: 'office-lead', expanded: true }))
  }
  assert.match(render(['blocked', 'queued', 'queued']), /等待店铺资料的只读访问授权/)
  assert.match(render(['completed', 'running', 'queued']), /周理正在复核/)
  const awaitingPublish = render(['completed', 'completed', 'queued'])
  assert.match(awaitingPublish, /发布需单独确认/)
  assert.doesNotMatch(awaitingPublish, /本次上架已获确认|本轮上架登记已完成/)
  assert.match(render(['completed', 'completed', 'running']), /赵审正在登记发布结果/)
  assert.match(render(['completed', 'completed', 'completed']), /本轮上架登记已完成/)
})
