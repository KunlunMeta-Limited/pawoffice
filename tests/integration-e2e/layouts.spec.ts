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
