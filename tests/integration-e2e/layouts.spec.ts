import { test, expect } from './fixtures.ts'
import { office } from './client.ts'
import type { LayoutInfo } from './client.ts'

test('external layout discovery, initialization, live switching and browser controls share one selection', async ({ page, service, backend }) => {
  const discovered = await backend.post<LayoutInfo>({ type: 'office.layout.read' })
  expect(discovered.code).toBe(200)
  expect(discovered.data.currentLayoutId).toBe('classic')
  expect(discovered.data.layouts.map(layout => layout.id)).toEqual(['classic', 'members'])
  expect(discovered.data.layouts.every(layout => layout.dataMessageType === 'office.snapshot')).toBe(true)

  const cached = await backend.post<LayoutInfo>({ type: 'offices.initialize', offices: [office()], layoutId: 'members' })
  expect(cached.code).toBe(202)
  expect(cached.data.currentLayoutId).toBe('members')
  await page.goto(`${service.url}/office/?shell=classic`)
  await expect(page.locator('.member-workspace')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(/正在加载办公室/)).toHaveCount(0, { timeout: 30000 })
  await page.evaluate(() => { (window as unknown as { layoutTestCanvas: HTMLCanvasElement }).layoutTestCanvas = document.querySelector('canvas')! })
  const input = page.getByRole('textbox', { name: '给办公室发送消息' })
  await input.fill('布局切换时保留的输入草稿')

  const switched = await backend.post<LayoutInfo>({ type: 'office.layout.set', layoutId: 'classic' })
  expect(switched.code).toBe(200)
  expect(switched.data.currentLayoutId).toBe('classic')
  await expect(page.locator('.runtime-workspace')).toBeVisible()
  await expect(input).toHaveValue('布局切换时保留的输入草稿')
  expect(await page.evaluate(() => document.querySelector('canvas') === (window as unknown as { layoutTestCanvas: HTMLCanvasElement }).layoutTestCanvas)).toBe(true)

  await page.getByRole('button', { name: '切换页面布局', exact: true }).click()
  await page.getByRole('button', { name: '成员布局', exact: true }).click()
  await expect(page.locator('.member-workspace')).toBeVisible()
  expect((await backend.post<LayoutInfo>({ type: 'office.layout.read' })).data.currentLayoutId).toBe('members')
  expect(await page.evaluate(() => document.querySelector('canvas') === (window as unknown as { layoutTestCanvas: HTMLCanvasElement }).layoutTestCanvas)).toBe(true)

  const next = office('team-a', 2)
  next.conversations[0].tasks[0].status = 'completed'
  expect((await backend.post({ type: 'office.snapshot', teamId: 'team-a', snapshot: next })).code).toBe(200)
  await expect(page.locator('.member-workspace')).toBeVisible()
  await page.reload()
  await expect(page.locator('.member-workspace')).toBeVisible()
  await expect(input).toHaveValue('布局切换时保留的输入草稿')
})

test('member layout keeps six room portraits while backend bindings and presence change per conversation', async ({ page, service, backend }) => {
  const state = office()
  await backend.post({ type: 'offices.initialize', offices: [state], layoutId: 'members' })
  await page.goto(`${service.url}/office/`)
  const roster = page.locator('.member-roster-grid')
  const portraits = roster.locator('.member-roster-person')
  const active = roster.locator('.member-presence.online')
  await expect(portraits).toHaveCount(6)
  await expect(roster.locator('.runtime-avatar img')).toHaveCount(6)
  await expect(active).toHaveCount(2)
  await expect(page.locator('.member-overview-card').last()).toContainText('2 / 6')
  const input = page.getByRole('textbox', { name: '给办公室发送消息' })
  await input.fill('稀疏成员数据更新时保留草稿')
  const idle = roster.locator('[data-actor-id="file-agent"]')
  await idle.click()
  await expect(idle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.member-profile-role')).toHaveText('当前会话未分配')
  await expect(page.locator('.member-profile-open')).toBeDisabled()
  await expect(page.locator('.member-current-task')).toContainText('当前没有关联任务')

  state.seq = 2; state.conversations[0].employees[0].online = false
  await backend.post({ type: 'office.snapshot', teamId: state.workspace.id, snapshot: state })
  await expect(portraits).toHaveCount(6)
  await expect(active).toHaveCount(1)
  await expect(roster.locator('[data-actor-id="office-lead"] .member-presence')).toHaveAttribute('aria-label', '空闲')
  await expect(idle).toHaveAttribute('aria-pressed', 'true')
  await expect(input).toHaveValue('稀疏成员数据更新时保留草稿')

  const review = structuredClone(state.conversations[0])
  review.id = 'review'; review.title = '复核会话'; review.tasks = []
  review.employees = [{ id: 'reviewer', sceneActorId: 'data-agent', name: '复核员', online: true }]
  state.seq = 3; state.conversations.push(review)
  await backend.post({ type: 'office.snapshot', teamId: state.workspace.id, snapshot: state })
  await page.getByRole('button', { name: '展开对话', exact: true }).click()
  await page.getByRole('tab', { name: '复核会话', exact: true }).click()
  await expect(portraits).toHaveCount(6)
  await expect(active).toHaveCount(1)
  await expect(roster.locator('[data-actor-id="data-agent"] .member-presence')).toHaveAttribute('aria-label', '活跃')
  await expect(roster.locator('[data-actor-id="code-agent"] .member-presence')).toHaveAttribute('aria-label', '空闲')
  await page.getByRole('tab', { name: '主会话', exact: true }).click()
  await expect(input).toHaveValue('稀疏成员数据更新时保留草稿')

  state.seq = 4; state.conversations[0].employees = []; state.conversations[0].tasks = []
  await backend.post({ type: 'office.snapshot', teamId: state.workspace.id, snapshot: state })
  await expect(portraits).toHaveCount(6)
  await expect(active).toHaveCount(0)
  await expect(page.locator('.member-overview-card').last()).toContainText('0 / 6')
  await expect(input).toHaveValue('稀疏成员数据更新时保留草稿')
})
