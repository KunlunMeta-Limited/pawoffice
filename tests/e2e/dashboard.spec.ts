import { expect, test } from '@playwright/test'

const gatewayOrigin = `http://127.0.0.1:${process.env.OFFICE_ACTION_GATEWAY_PORT || '8765'}`

test('仪表板加载真实网关数据并对未开放中心正确降级', async ({ page, request }) => {
  const health = await request.get(`${gatewayOrigin}/health`)
  expect(health.ok()).toBe(true)
  await expect(health.json()).resolves.toMatchObject({ ok: true })

  const agents = await request.get(`${gatewayOrigin}/office/agents`)
  expect(agents.ok()).toBe(true)
  await expect(agents.json()).resolves.toHaveLength(6)

  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/')
  await expect(page.getByText('AI Office')).toBeVisible()
  await expect(page.getByRole('heading', { name: '智能体状态' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '快捷工具' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '任务中心' })).toHaveCount(0)
  await expect(page.locator('.task-card')).toHaveCount(0)
  await expect.poll(() => requests.filter((url) => new URL(url).pathname.startsWith('/office/')).length).toBeGreaterThanOrEqual(2)
  await expect.poll(() => requests.some((url) => new URL(url).pathname === '/office/sessions')).toBe(true)

  // 真实网关通常同时包含项目文件与空的 OpenPaw 数据目录，这里接受两种已稳定状态。
  await expect.poll(async () => {
    const empty = await page.getByText('暂无数据').count()
    const rows = await page.locator('.task-card, .activity-list li').count()
    return empty + rows
  }).toBeGreaterThan(0)

  await page.getByRole('button', { name: '任务中心' }).click()
  await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible()
  await expect(page.locator('.office-main canvas')).toBeVisible()

  await page.getByRole('button', { name: '浏览器助手' }).click()
  await expect(page.getByRole('heading', { name: '浏览器助手' })).toBeVisible()
  await expect(page.locator('.office-right-panel .data-state').filter({ hasText: '不支持' })).toBeVisible()

  await page.getByRole('button', { name: '日程日历' }).click()
  await expect(page.getByRole('heading', { name: '日程日历' })).toBeVisible()
  await expect(page.locator('.office-right-panel .data-state').filter({ hasText: '不支持' })).toBeVisible()
  await page.getByRole('button', { name: '通知中心' }).click()
  await expect(page.getByRole('heading', { name: '通知中心' })).toBeVisible()
  await expect.poll(() => requests.some((url) => new URL(url).pathname === '/office/notifications')).toBe(true)
  expect(requests.some((url) => new URL(url).pathname === '/office/calendar/events')).toBe(false)
  expect(requests.some((url) => new URL(url).pathname === '/office/ocr')).toBe(false)
  expect(requests.some((url) => new URL(url).pathname === '/browser')).toBe(false)
})

test('未选择会话时只显示主空间且不请求无 sessionId 的空间全集', async ({ page }) => {
  const workspaceRequests: string[] = []
  await page.addInitScript(() => window.sessionStorage.clear())
  await page.route('**/office/workspaces*', async (route) => {
    workspaceRequests.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: '我的空间', exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(workspaceRequests).toEqual([])
})

test('文件中心在中央空间查看文件并保留右侧文件列表', async ({ page }) => {
  await page.route('**/office/files', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ path: '验证说明.md', type: 'file' }]) })
  })
  await page.route('**/office/workspace', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ root: 'D:/workspace' }) })
  })
  await page.route('**/office/file?path=*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: '验证说明.md',
      content: '# 中央文件预览\n\n文件正文需要在 Windows 下清晰显示，行内 `route.json` 不能继续缩小。\n\n| 日期 | 上午行程 | 下午行程 | 晚间安排 | 核验状态 |\n| --- | --- | --- | --- | --- |\n| 第一天 | 城区集合与交通换乘 | 海滨路线和地点介绍 | 餐厅与住宿办理 | 已交叉核验 |',
    }) })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '文件中心' }).click()
  await page.getByRole('button', { name: '验证说明.md' }).click()

  const viewer = page.getByRole('dialog', { name: '查看文件 验证说明.md' })
  const backdrop = page.locator('.workspace-file-viewer-backdrop')
  await expect(viewer).toBeVisible()
  await expect(backdrop).toBeVisible()
  await expect(backdrop).toHaveCSS('background-color', 'rgba(38, 42, 43, 0.28)')
  await expect(page.getByRole('heading', { name: '文件中心' })).toBeVisible()
  await expect(viewer.getByRole('heading', { name: '中央文件预览' })).toBeVisible()
  const markdown = viewer.locator('.assistant-rich-text')
  const tableWrap = viewer.locator('.markdown-table-wrap')
  await expect(markdown).toHaveCSS('font-size', '15px')
  await expect(markdown).toHaveCSS('font-family', /Microsoft YaHei UI/)
  await expect(tableWrap.locator('table')).toHaveCSS('font-size', '15px')
  await expect(tableWrap.locator('td').first()).toHaveCSS('padding-top', '9px')
  await expect(tableWrap).toHaveCSS('scrollbar-gutter', 'stable')
  await expect(markdown.locator('code')).toHaveCSS('font-size', '14px')
  const mainBox = await page.locator('.office-main').boundingBox()
  const dialogBox = await viewer.boundingBox()
  expect(mainBox).not.toBeNull()
  expect(dialogBox).not.toBeNull()
  expect(dialogBox!.width).toBeLessThan(mainBox!.width)
  expect(dialogBox!.height).toBeLessThan(mainBox!.height)

  await page.setViewportSize({ width: 378, height: 720 })
  await expect(tableWrap.locator('table')).toHaveCSS('font-size', '15px')
  const tableSize = await tableWrap.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
  expect(tableSize.scrollWidth).toBeGreaterThan(tableSize.clientWidth)
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: '验证说明.md' }).click()
  const desktopBackdropBox = await page.locator('.workspace-file-viewer-backdrop').boundingBox()
  expect(desktopBackdropBox).not.toBeNull()
  await page.locator('.workspace-file-viewer-backdrop').click({ position: { x: 9, y: desktopBackdropBox!.height / 2 } })
  await expect(viewer).toHaveCount(0)

  await page.getByRole('button', { name: '验证说明.md' }).click()
  await page.getByRole('button', { name: '关闭文件查看器' }).click()
  await expect(viewer).toHaveCount(0)
  await expect(page.locator('.office-main canvas')).toBeVisible()
})

test('文件中心把 GeoJSON 路线渲染为可切换底图的交互地图', async ({ page }) => {
  await page.route('**/office/files', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ path: 'routes/sample.geojson', type: 'file' }]) })
  })
  await page.route('**/office/workspace', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ root: 'D:/workspace' }) })
  })
  await page.route('**/office/file?path=*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: 'routes/sample.geojson',
      content: JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [113.26, 23.13] }, properties: { name: '起点' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[113.26, 23.13], [112.94, 28.23]] }, properties: { name: '路线' } },
      ] }),
    }) })
  })
  await page.route('**/ArcGIS/rest/services/**', async (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('/')
  await page.getByRole('button', { name: '文件中心' }).click()
  await page.getByRole('button', { name: 'routes/sample.geojson' }).click()
  await expect(page.getByLabel('路线地图')).toBeVisible()
  await expect(page.getByText(/2 个地点 · 1 条路线 · \d+ km · GEOJSON/)).toBeVisible()
  await page.getByRole('button', { name: '仅路线' }).click()
  await expect(page.getByRole('button', { name: '仅路线' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('路线地图')).toHaveAttribute('data-route-count', '1')
  await expect(page.locator('.artifact-map .leaflet-overlay-pane canvas')).toBeVisible()
})

test('文件中心通用显示 HTML 原页并提供统一阅读模式', async ({ page }) => {
  let insecureResourceRequested = false
  await page.context().route('http://cdn.example.test/blocked.js', async (route) => {
    insecureResourceRequested = true
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'parent.__insecure=true' })
  })
  await page.route('**/office/files', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { path: 'report.html', type: 'file' },
      { path: 'route-map.html', type: 'file' },
      { path: 'places.csv', type: 'file' },
      { path: 'pois.json', type: 'file' },
    ]) })
  })
  await page.route('**/office/workspace', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ root: 'D:/workspace' }) })
  })
  await page.route('**/office/file?path=report.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: 'report.html',
      content: '<!doctype html><style>h1{font:700 42px Georgia,serif;color:#17324d}</style><main><h1 id="status">可交互报告</h1><button onclick="document.getElementById(\'status\').textContent=\'交互已运行\'">运行交互</button><table><tr><th>日期</th><th>行程</th></tr><tr><td>第一天</td><td>海滨路线</td></tr></table><script>try{parent.__unsafe=true}catch{}</script><script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script><script>document.documentElement.dataset.externalLoaded=typeof L</script><script src="http://cdn.example.test/blocked.js"></script><iframe src="https://example.test"></iframe></main>',
    }) })
  })
  await page.route('**/office/file?path=places.csv', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: 'places.csv', content: '名称,纬度,经度,地址\n起点,23.13,113.26,入口\n终点,24.48,118.08,码头',
    }) })
  })
  await page.route('**/office/file?path=route-map.html', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: 'route-map.html',
      content: '<!doctype html><style>body{font-family:system-ui;margin:0;padding:24px}#map{min-height:240px;padding:20px;background:#e8f1f5}</style><h1>七日路线网页</h1><button onclick="showDay(1)">显示第二天</button><main id="map">第一天：车站到酒店</main><script>const DAYS=[{name:"第一天",stops:[{n:"车站",lat:23.13,lng:113.26}]},{name:"第二天",stops:[{n:"公园",lat:23.15,lng:113.28}]}];const ROUTES=DAYS;function showDay(index){document.getElementById("map").textContent=DAYS[index].name+"：公园到博物馆"}</script>',
    }) })
  })
  await page.route('**/office/file?path=pois.json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      path: 'pois.json', content: JSON.stringify({ pois: [{ name: 'JSON 景点', lng: 113.26, lat: 23.13, description: '普通 JSON 点位' }] }),
    }) })
  })
  await page.route('**/ArcGIS/rest/services/**', async (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('/')
  await page.getByRole('button', { name: '文件中心' }).click()
  await page.getByRole('button', { name: 'report.html' }).click()
  const htmlViewer = page.getByRole('dialog', { name: '查看文件 report.html' })
  const originalFrame = htmlViewer.getByTitle('HTML 原页预览')
  await expect(originalFrame).toBeVisible()
  await expect(htmlViewer.locator('.workspace-file-viewer-body')).toHaveCSS('padding-top', '18px')
  await expect(htmlViewer.getByLabel('HTML 内容')).toHaveCSS('border-top-width', '1px')
  await expect(htmlViewer.getByLabel('HTML 内容')).toHaveCSS('border-radius', '7px')
  await expect(originalFrame).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(originalFrame).not.toHaveAttribute('sandbox', /allow-same-origin/)
  await expect(originalFrame.contentFrame().locator('html')).toHaveAttribute('data-external-loaded', 'object')
  await expect(originalFrame.contentFrame().getByRole('heading', { name: '可交互报告' })).toHaveCSS('font-size', '42px')
  expect(insecureResourceRequested).toBe(false)
  await originalFrame.contentFrame().getByRole('button', { name: '运行交互' }).click()
  await expect(originalFrame.contentFrame().getByRole('heading', { name: '交互已运行' })).toBeVisible()
  await expect(page.evaluate(() => (window as Window & { __unsafe?: boolean }).__unsafe)).resolves.toBeUndefined()
  await htmlViewer.getByRole('button', { name: '重新加载原页' }).click()
  await expect(htmlViewer.getByTitle('HTML 原页预览').contentFrame().getByRole('heading', { name: '可交互报告' })).toBeVisible()
  await htmlViewer.getByRole('button', { name: '源码' }).click()
  await expect(htmlViewer.getByText(/parent\.__unsafe/)).toBeVisible()
  await htmlViewer.getByRole('button', { name: '阅读模式' }).click()
  const readerFrame = htmlViewer.getByTitle('HTML 阅读预览')
  await expect(readerFrame).toBeVisible()
  await expect(readerFrame).toHaveAttribute('sandbox', '')
  await expect(readerFrame.contentFrame().getByRole('button', { name: '运行交互' })).toBeVisible()
  await expect(readerFrame.contentFrame().getByRole('heading', { name: '可交互报告' })).toHaveCSS('font-size', '30px')
  await expect(readerFrame.contentFrame().locator('body')).toHaveCSS('font-family', /Microsoft YaHei UI/)
  await expect(readerFrame.contentFrame().locator('body')).toHaveCSS('font-size', '16px')
  await expect(readerFrame.contentFrame().locator('table')).toHaveCSS('font-size', '14px')

  await page.getByRole('button', { name: '关闭文件查看器' }).click()
  await page.getByRole('button', { name: 'route-map.html' }).click()
  const mapViewer = page.getByRole('dialog', { name: '查看文件 route-map.html' })
  await expect(mapViewer).not.toHaveClass(/map-preview/)
  const routeFrame = mapViewer.getByTitle('HTML 原页预览')
  await expect(routeFrame.contentFrame().getByRole('heading', { name: '七日路线网页' })).toBeVisible()
  await expect(mapViewer.getByRole('button', { name: '路线地图' })).toHaveCount(0)
  await expect(routeFrame.contentFrame().locator('#map')).toHaveText('第一天：车站到酒店')
  await routeFrame.contentFrame().getByRole('button', { name: '显示第二天' }).click()
  await expect(routeFrame.contentFrame().locator('#map')).toHaveText('第二天：公园到博物馆')
  await mapViewer.getByRole('button', { name: '阅读模式' }).click()
  await expect(mapViewer.getByTitle('HTML 阅读预览').contentFrame().locator('#map')).toHaveText('第一天：车站到酒店')

  await page.getByRole('button', { name: '关闭文件查看器' }).click()
  await page.getByRole('button', { name: 'places.csv' }).click()
  await expect(page.getByLabel('路线地图')).toBeVisible()
  await page.waitForTimeout(500)
  await page.locator('.artifact-map-marker').first().click()
  await expect(page.getByRole('complementary', { name: '地点信息' })).toContainText('起点')
  await expect(page.getByRole('complementary', { name: '地点信息' })).toContainText('入口')
  await page.getByRole('button', { name: '关闭地点信息' }).click()
  await expect(page.getByRole('complementary', { name: '地点信息' })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭文件查看器' }).click()
  await page.getByRole('button', { name: 'pois.json' }).click()
  await expect(page.getByLabel('路线地图')).toHaveAttribute('data-point-count', '1')
  await expect(page.getByText(/1 个地点 · 0 条路线 · JSON/)).toBeVisible()
  await page.locator('.artifact-map-poi-marker').click()
  await expect(page.getByRole('complementary', { name: '地点信息' })).toContainText('普通 JSON 点位')
})

test('页面支持新建任务、命名对话和通知操作', async ({ page }) => {
  test.setTimeout(45_000)
  await page.route('**/office/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ promptAccepted: false, session: { id: 'e2e-session', title: 'E2E 对话', provider: 'openai', model: 'gpt-4o', createdAt: Date.now(), updatedAt: Date.now() } }) })
  })
  await page.route('**/office/conversations/e2e-session/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  let conversationMessage = '请回复测试'
  const conversationMessages: Array<{ info: { id: string; role: 'user' | 'assistant' }; parts: Array<{ type: 'text'; text: string }> }> = []
  await page.route('**/office/conversations/e2e-session/messages', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversationMessages) })
      return
    }
    conversationMessages.push(
      { info: { id: `user-${conversationMessages.length}`, role: 'user' }, parts: [{ type: 'text', text: conversationMessage }] },
      { info: { id: `assistant-${conversationMessages.length}`, role: 'assistant' }, parts: [{ type: 'text', text: `智能体已回复：${conversationMessage}` }] },
    )
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true, sessionId: 'e2e-session' }) })
  })
  await page.route('**/office/conversations/e2e-session', async (route) => {
    await route.fulfill({ status: 204, body: '' })
  })
  await page.goto('/')
  await expect(page.getByText('AI Office')).toBeVisible()

  await page.getByRole('button', { name: '任务中心' }).click()
  await page.getByPlaceholder('例如：整理本周会议纪要').fill('E2E 新任务')
  await page.getByPlaceholder('可选，例如：包含结论、负责人和截止时间').fill('返回可核验的 E2E 结果')
  await page.getByRole('button', { name: '快速执行' }).click()
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await expect(page.getByText('任务已创建')).toBeVisible()
  const taskCard = page.locator('.task-card').filter({ hasText: 'E2E 新任务' })
  await expect(taskCard).toBeVisible()
  await taskCard.getByText('目标详情').click()
  await expect(taskCard.getByText('返回可核验的 E2E 结果')).toBeVisible()
  await expect(taskCard.getByText('快速执行')).toBeVisible()
  await expect(taskCard.getByText('第 1 次')).toBeVisible()
  await expect(taskCard.locator('.task-status').getByText('已完成', { exact: true })).toBeVisible({ timeout: 15_000 })
  page.once('dialog', (dialog) => dialog.accept())
  await taskCard.getByRole('button', { name: '删除任务' }).click()
  await expect(taskCard).toHaveCount(0)

  await page.getByRole('button', { name: '对话中心' }).click()
  await expect(page.getByRole('heading', { name: '对话中心' })).toBeVisible()
  await page.getByRole('button', { name: '+ 新建对话' }).click()
  await page.getByLabel('对话名称').fill('E2E 对话')
  await page.getByRole('button', { name: '创建对话' }).click()
  await expect(page.getByRole('combobox', { name: '最近对话' })).toHaveValue('e2e-session')
  await expect(page.getByText('对话已创建，可开始发送消息')).toHaveCount(0)
  conversationMessage = '继续测试'
  await page.getByLabel('输入下一条消息').fill(conversationMessage)
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('智能体已回复：继续测试')).toBeVisible()

  await page.getByRole('button', { name: '通知中心' }).click()
  const unread = page.getByRole('button', { name: '标为已读' }).first()
  if (await unread.count()) {
    await unread.click()
    await expect(page.getByText('已读').first()).toBeVisible()
  }
})

test('常用窗口宽度下办公室画布保持可见且不被右栏遮挡', async ({ page }) => {
  for (const viewport of [
    { width: 1180, height: 800 },
    { width: 1024, height: 768 },
    { width: 900, height: 768 },
    { width: 760, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const canvas = page.locator('.office-main canvas')
    await expect(canvas).toBeVisible()
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(0)

    const canvasBox = await canvas.boundingBox()
    const panelBox = await page.locator('.office-right-panel').boundingBox()
    expect(canvasBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    if (viewport.width > 760 && canvasBox && panelBox) {
      // At tablet/desktop widths the panel is in normal flex flow, so its
      // left edge must be at or after the canvas right edge.
      expect(panelBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width - 1)
    }
  }
})

test('桌面右栏收窄且对话中心可无重建地切换专注模式', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 })
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'focus-session', title: '专注模式对话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]) })
  })
  await page.route('**/office/conversations/focus-session/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/office/conversations/focus-session/messages', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '任务中心' }).click()
  const regularPanelBox = await page.locator('.office-right-panel').boundingBox()
  const regularCanvasBox = await page.locator('.office-main canvas').boundingBox()
  expect(regularPanelBox?.width ?? 0).toBeGreaterThanOrEqual(279)
  expect(regularPanelBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(321)
  expect(regularCanvasBox?.width ?? 0).toBeGreaterThanOrEqual(560)

  const workspaceLoaded = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/office/workspaces' && url.searchParams.get('sessionId') === 'focus-session'
  })
  await page.getByRole('button', { name: '对话中心' }).click()
  await workspaceLoaded
  const canvas = page.locator('.office-main canvas')
  await expect(page.getByRole('combobox', { name: '最近对话' })).toHaveValue('focus-session')
  await canvas.evaluate((element) => element.setAttribute('data-e2e-instance', 'stable'))
  await expect(page.getByRole('button', { name: '隐藏办公室' })).toHaveAttribute('aria-pressed', 'false')
  const normalConversationBox = await page.locator('.office-right-panel.is-conversation').boundingBox()
  expect(normalConversationBox?.width ?? 0).toBeGreaterThanOrEqual(279)
  expect(normalConversationBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(321)
  expect(Math.abs((normalConversationBox?.width ?? 0) - (regularPanelBox?.width ?? 0))).toBeLessThanOrEqual(1)
  const normalRows = await page.locator('.conversation-layout').evaluate((element) => getComputedStyle(element).gridTemplateRows)
  expect(Number.parseFloat(normalRows.split(' ')[0])).toBeGreaterThanOrEqual(38)
  expect(Number.parseFloat(normalRows.split(' ')[0])).toBeLessThanOrEqual(60)

  await page.getByRole('button', { name: '隐藏办公室' }).click()
  await expect(page.locator('.office-app')).toHaveClass(/conversation-focus-mode/)
  await expect(page.getByRole('button', { name: '显示办公室' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.office-center')).toBeHidden()
  const focusedPanelBox = await page.locator('.office-right-panel.is-conversation').boundingBox()
  expect(focusedPanelBox?.width ?? 0).toBeGreaterThan(900)
  const columns = await page.locator('.conversation-layout').evaluate((element) => getComputedStyle(element).gridTemplateColumns)
  expect(columns.split(' ')).toHaveLength(2)
  await expect(page.locator('.conversation-list-pane')).toBeVisible()
  await expect(page.locator('.conversation-list-pane .session-select', { hasText: '专注模式对话' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '最近对话' })).toHaveCount(0)

  await page.getByRole('button', { name: '显示办公室' }).click()
  await expect(page.locator('.office-app')).not.toHaveClass(/conversation-focus-mode/)
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-e2e-instance', 'stable')
})

test('378x515 移动端进入对话中心时导航、消息区和输入框不溢出视口', async ({ page }) => {
  await page.setViewportSize({ width: 378, height: 515 })
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'mobile-session', title: '移动端对话', provider: 'echo', model: 'echo-1', createdAt: Date.now(), updatedAt: Date.now() }]) })
  })
  await page.route('**/office/conversations/mobile-session/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/office/conversations/mobile-session/messages', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ info: { id: 'mobile-user', role: 'user' }, parts: [{ type: 'text', text: '移动端消息' }] }]) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '对话中心' }).click()
  await expect(page.getByRole('heading', { name: '对话中心' })).toBeVisible()
  const panel = page.locator('.office-right-panel.is-conversation')
  const composer = page.getByLabel('输入下一条消息')
  await expect(composer).toBeVisible()
  const normalPanelBox = await panel.boundingBox()
  const normalComposerBox = await composer.boundingBox()
  expect(normalPanelBox).not.toBeNull()
  expect(normalComposerBox).not.toBeNull()
  if (normalPanelBox && normalComposerBox) {
    expect(normalPanelBox.x + normalPanelBox.width).toBeLessThanOrEqual(378)
    expect(normalComposerBox.x + normalComposerBox.width).toBeLessThanOrEqual(378)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(378)
  const canvas = page.locator('.office-main canvas')
  await canvas.evaluate((element) => element.setAttribute('data-e2e-instance', 'stable'))
  await page.getByRole('button', { name: '隐藏办公室' }).click()
  await expect(page.locator('.office-center')).toBeHidden()
  await expect(page.getByRole('button', { name: '显示办公室' })).toBeVisible()
  const panelBox = await panel.boundingBox()
  const composerBox = await composer.boundingBox()
  expect(panelBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  if (panelBox && composerBox) {
    expect(panelBox.x).toBeGreaterThanOrEqual(0)
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(378)
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(378)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(378)
  await page.getByRole('button', { name: '显示办公室' }).click()
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-e2e-instance', 'stable')
})

test('多会话可并行切换、逆序完成并在运行中创建和停止新会话', async ({ page }) => {
  type Fixture = { active: boolean; abortCount: number; turnID: string; userMessageID: string; submittedText: string; messages: unknown[] }
  const fixtures = new Map([
    ['a', { active: false, abortCount: 0, turnID: 'turn-a', userMessageID: 'user-a', submittedText: '', messages: [] as unknown[] }],
    ['b', { active: false, abortCount: 0, turnID: 'turn-b', userMessageID: 'user-b', submittedText: '', messages: [] as unknown[] }],
    ['c', { active: false, abortCount: 0, turnID: 'turn-c', userMessageID: 'user-c', submittedText: '', messages: [] as unknown[] }],
  ] as Array<[string, Fixture]>)
  const completeFixture = (sessionId: string, assistantText: string) => {
    const fixture = fixtures.get(sessionId)!
    fixture.active = false
    fixture.messages = [
      { info: { id: fixture.userMessageID, role: 'user', turnID: fixture.turnID }, parts: [{ type: 'text', text: fixture.submittedText }] },
      { info: { id: `assistant-${sessionId}`, role: 'assistant', turnID: fixture.turnID }, parts: [{ type: 'text', text: assistantText }] },
      { info: { id: `completed-${sessionId}`, role: 'system', kind: 'completed', turnID: fixture.turnID }, parts: [] },
    ]
  }
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'a', title: '并行对话 A', provider: 'echo', model: 'mock', createdAt: 3, updatedAt: 3 },
      { id: 'b', title: '并行对话 B', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
    ]) })
  })
  await page.route('**/office/conversations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ promptAccepted: false, session: { id: 'c', title: '并行对话 C', provider: 'echo', model: 'mock', createdAt: 4, updatedAt: 4 } }) })
  })
  await page.route('**/office/conversations/status', async (route) => {
    const statuses = Object.fromEntries([...fixtures.entries()]
      .filter(([, fixture]) => fixture.active)
      .map(([sessionId, fixture]) => [sessionId, {
        type: 'busy',
        turnID: fixture.turnID,
        userMessageID: fixture.userMessageID,
        activity: { kind: 'thinking' },
      }]))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statuses) })
  })
  await page.route(/\/office\/conversations\/(a|b|c)\/(messages|status|abort)$/, async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/office\/conversations\/(a|b|c)\/(messages|status|abort)$/)
    const sessionId = match?.[1] || ''
    const action = match?.[2] || ''
    const fixture = fixtures.get(sessionId)!
    if (action === 'status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.active ? { [sessionId]: { type: 'busy', turnID: fixture.turnID, userMessageID: fixture.userMessageID, activity: { kind: 'thinking' } } } : {}) })
      return
    }
    if (action === 'abort') {
      fixture.abortCount += 1
      fixture.active = false
      fixture.messages = [
        { info: { id: fixture.userMessageID, role: 'user', turnID: fixture.turnID }, parts: [{ type: 'text', text: fixture.submittedText }] },
        { info: { id: `${sessionId}-cancelled`, role: 'system', kind: 'cancelled', turnID: fixture.turnID }, parts: [{ type: 'text', text: '本轮已停止。' }] },
      ]
      await route.fulfill({ status: 204, body: '' })
      return
    }
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON() as { parts?: Array<{ type?: string; text?: string }> }
      fixture.submittedText = payload.parts?.filter((part) => part.type === 'text').map((part) => part.text || '').join('') || ''
      fixture.active = true
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true, sessionId }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.messages) })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '对话中心' }).click()
  const sessionSelect = page.getByRole('combobox', { name: '最近对话' })
  await expect(sessionSelect).toHaveValue('a')
  await page.getByLabel('输入下一条消息').fill('A 正在执行')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('A 正在执行')).toBeVisible()
  await sessionSelect.click()
  await expect(page.locator('.conversation-session-option').filter({ hasText: '并行对话 A' }).locator('.session-running-dot')).toBeVisible()
  await page.locator('.conversation-session-option').filter({ hasText: '并行对话 B' }).click()
  await expect(sessionSelect).toHaveValue('b')

  await expect(page.getByLabel('输入下一条消息')).toBeEnabled()
  await page.getByLabel('输入下一条消息').fill('B 正在执行')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('B 正在执行')).toBeVisible()
  await sessionSelect.click()
  await expect(page.locator('.conversation-session-option').filter({ hasText: '并行对话 B' }).locator('.session-running-dot')).toBeVisible()
  await sessionSelect.click()

  completeFixture('b', 'B 已先完成')
  await expect(page.getByText('B 已先完成')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: '+ 新建对话' }).click()
  await page.getByLabel('对话名称').fill('并行对话 C')
  await page.getByRole('button', { name: '创建对话' }).click()
  await expect(sessionSelect).toHaveValue('c')
  completeFixture('a', 'A 已后完成')
  await expect(sessionSelect).toHaveValue('c')
  await expect(page.getByText('A 已后完成')).toHaveCount(0)
  await page.getByRole('button', { name: '隐藏办公室' }).click()
  await expect(page.getByRole('button', { name: '显示办公室' })).toBeVisible()
  const unreadDot = page.locator('.session-list li').filter({ hasText: '并行对话 A' }).locator('.session-unread-dot')
  await expect(unreadDot).toBeVisible()
  await expect.poll(() => unreadDot.evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(74, 134, 197)')
  await page.getByRole('button', { name: '显示办公室' }).click()
  await page.getByLabel('输入下一条消息').fill('C 正在执行')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect.poll(() => fixtures.get('c')?.abortCount).toBe(1)
  await expect(page.getByText('本轮已停止。')).toBeVisible()
  await expect(page.getByLabel('输入下一条消息')).toBeEnabled()

  await sessionSelect.selectOption('a')
  await expect(page.getByText('A 已后完成')).toBeVisible({ timeout: 5000 })
  await expect(page.getByLabel('输入下一条消息')).toBeEnabled()
})

test('切换对话时工作空间数量、名称和状态按 sessionId 独立刷新', async ({ page }) => {
  const workspaceRequests: string[] = []
  const agents = (activeRosterNo?: number) => Array.from({ length: 6 }, (_, index) => ({
    rosterNo: index + 1,
    id: `agent-${index + 1}`,
    name: `角色 ${index + 1}`,
    state: activeRosterNo === index + 1 ? 'working' : 'idle',
    task: activeRosterNo === index + 1 ? '正在处理' : '',
  }))
  const workspaces = {
    a: [
      { id: 'a', name: '我的空间', kind: 'main', sessionId: 'a', updatedAt: 2, agents: agents(1) },
      { id: 'a-research', name: '研究 Agent', kind: 'subagent', parentWorkspaceId: 'a', sessionId: 'a', updatedAt: 2, agents: agents(2) },
    ],
    b: [
      { id: 'b', name: '我的空间', kind: 'main', sessionId: 'b', updatedAt: 3, agents: agents(1) },
      { id: 'b-writer', name: '撰写 Agent', kind: 'subagent', parentWorkspaceId: 'b', sessionId: 'b', updatedAt: 3, agents: agents(4) },
      { id: 'b-review', name: '审核 Agent', kind: 'subagent', parentWorkspaceId: 'b', sessionId: 'b', updatedAt: 3, agents: agents(6) },
    ],
  }
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'a', title: '空间对话 A', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
      { id: 'b', title: '空间对话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]) })
  })
  await page.route('**/office/workspaces*', async (route) => {
    const url = new URL(route.request().url())
    const sessionId = url.searchParams.get('sessionId')
    workspaceRequests.push(sessionId || '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionId === 'b' ? workspaces.b : sessionId === 'a' ? workspaces.a : []) })
  })
  await page.route(/\/office\/conversations\/(a|b)\/(messages|status)$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: route.request().url().endsWith('/messages') ? '[]' : '{}' })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '对话中心' }).click()
  const sessionSelect = page.getByRole('combobox', { name: '最近对话' })
  await expect(sessionSelect).toHaveValue('a')
  await expect(page.getByRole('button', { name: '研究 Agent', exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: '空间总览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '撰写 Agent', exact: true })).toHaveCount(0)

  await sessionSelect.selectOption('b')
  await expect(page.getByRole('button', { name: '撰写 Agent', exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: '审核 Agent', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '研究 Agent', exact: true })).toHaveCount(0)
  await expect(page.locator('.workspace-list .workspace-row')).toHaveCount(4)

  await sessionSelect.selectOption('a')
  await expect(page.getByRole('button', { name: '研究 Agent', exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: '撰写 Agent', exact: true })).toHaveCount(0)
  expect(workspaceRequests).toContain('a')
  expect(workspaceRequests).toContain('b')
})

test('长回复和失败正文在刷新后保留，且恢复对话中心与选中会话', async ({ page }) => {
  test.setTimeout(60_000)
  const longReply = '长难句包含中文、emoji😀、引号"、反斜杠\\和换行。\n'.repeat(5000).slice(0, 180_004)
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'persisted-long', title: '刷新保留会话', provider: 'mock', model: 'mock', createdAt: 2, updatedAt: 2 },
      { id: 'other-session', title: '其它会话', provider: 'mock', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]) })
  })
  await page.route('**/office/conversations/persisted-long/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/office/conversations/persisted-long/messages', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { info: { id: 'long-user', role: 'user', turnID: 'long-turn' }, parts: [{ type: 'text', text: '请返回完整长回复' }] },
      { info: { id: 'long-assistant', role: 'assistant', turnID: 'long-turn' }, parts: [{ type: 'text', text: longReply }] },
      { info: { id: 'long-completed', role: 'system', kind: 'completed', turnID: 'long-turn' }, parts: [] },
      { info: { id: 'failed-user', role: 'user', turnID: 'failed-turn' }, parts: [{ type: 'text', text: '这一轮会失败' }] },
      { info: { id: 'failed-system', role: 'system', kind: 'error', turnID: 'failed-turn' }, parts: [{ type: 'text', text: '模型服务响应超时，本轮未完成，请稍后重试。' }] },
    ]) })
  })
  await page.route(/\/office\/conversations\/other-session\/(status|messages)$/, async (route) => {
    const statusRoute = new URL(route.request().url()).pathname.endsWith('/status')
    await route.fulfill({ status: 200, contentType: 'application/json', body: statusRoute ? '{}' : '[]' })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '对话中心' }).click()
  await expect(page.getByRole('combobox', { name: '最近对话' })).toHaveValue('persisted-long')
  const assistant = page.locator('.transcript-message.assistant .message-content').first()
  await expect(assistant).toHaveText(longReply)
  await expect(page.getByText('模型服务响应超时，本轮未完成，请稍后重试。')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '对话中心' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '最近对话' })).toHaveValue('persisted-long')
  await expect(page.locator('.transcript-message.assistant .message-content').first()).toHaveText(longReply)
  await expect(page.getByText('模型服务响应超时，本轮未完成，请稍后重试。')).toBeVisible()
})

test('任务深链只选择一次且最近对话使用紧凑下拉栏', async ({ page }) => {
  const sessions = Array.from({ length: 8 }, (_, index) => ({
    id: `session-${index + 1}`,
    title: `最近对话 ${index + 1}`,
    provider: 'echo',
    model: 'mock',
    createdAt: 8 - index,
    updatedAt: 8 - index,
  }))
  await page.route('**/office/tasks', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'task-linked', objective: '深链任务', status: 'in_progress', priority: 'normal', nextAction: '执行中', sessionId: 'session-2' },
      { id: 'task-other', objective: '其它任务', status: 'completed', priority: 'normal', nextAction: '' },
    ]) })
  })
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) })
  })
  await page.route(/\/office\/conversations\/session-\d+\/(messages|status)$/, async (route) => {
    const status = new URL(route.request().url()).pathname.endsWith('/status')
    await route.fulfill({ status: 200, contentType: 'application/json', body: status ? '{}' : '[]' })
  })

  await page.setViewportSize({ width: 852, height: 675 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /任务中心/ })).toContainText('2')
  await page.getByRole('button', { name: '任务中心' }).click()
  await page.getByRole('button', { name: '查看执行对话' }).first().click()
  const recentSelect = page.getByRole('combobox', { name: '最近对话' })
  await expect(recentSelect).toHaveValue('session-2')
  await recentSelect.selectOption('session-4')
  await expect(recentSelect).toHaveValue('session-4')
  await page.waitForTimeout(100)
  await expect(recentSelect).toHaveValue('session-4')

  const switcherHeight = await page.locator('.conversation-switcher').evaluate((element) => element.getBoundingClientRect().height)
  const workspaceHeight = await page.locator('.conversation-workspace').evaluate((element) => element.getBoundingClientRect().height)
  expect(switcherHeight).toBeGreaterThanOrEqual(38)
  expect(switcherHeight).toBeLessThanOrEqual(60)
  expect(workspaceHeight).toBeGreaterThan(switcherHeight * 4)
  await expect(recentSelect.locator('option')).toHaveCount(8)
  await expect(page.getByText('默认配置')).toHaveCount(0)
})

test('空闲场景画布非空且不会出现自动任务活动', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.office-main canvas')
  await expect(canvas).toBeVisible()
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('webgl2') || target.getContext('webgl')
    if (!context || target.width === 0 || target.height === 0) return 0
    const pixels = new Uint8Array(target.width * target.height * 4)
    context.readPixels(0, 0, target.width, target.height, context.RGBA, context.UNSIGNED_BYTE, pixels)
    let changed = 0
    for (let index = 0; index < pixels.length; index += 64) {
      if (pixels[index] || pixels[index + 1] || pixels[index + 2] || pixels[index + 3]) changed += 1
    }
    return changed
  })).toBeGreaterThan(0)
  await page.waitForTimeout(10_000)
  await expect(page.locator('.office-main canvas')).toBeVisible()
  await expect(page.getByText(/正在交接|递送中|自动工作流/)).toHaveCount(0)
})

test('空间总览按真实子 Agent 动作生成完整办公室并展示跨空间交接', async ({ page, request }) => {
  test.setTimeout(45_000)
  const sessionId = 'workspace-e2e-session'
  const sceneWarnings: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'warning' && (text.includes('场景资源清理失败') || text.includes('[Resolver] already has key'))) sceneWarnings.push(text)
  })
  await page.route('**/office/sessions', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: sessionId, title: '多空间验证对话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]) })
  })
  await page.route(`**/office/conversations/${sessionId}/status`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route(`**/office/conversations/${sessionId}/messages`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route(`**/office/conversations/${sessionId}/artifacts**`, async (route) => {
    const workspaceId = new URL(route.request().url()).searchParams.get('workspaceId')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspaceId === 'research-agent' ? [{ id: 'research-output', sessionId, workspaceId, path: '研究产物.md', name: '研究产物.md', kind: 'markdown', mimeType: 'text/markdown', size: 128, updatedAt: 1 }] : []) })
  })
  await page.route('**/office/file?path=*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '研究产物.md', content: '# 研究产物\n\n子 Agent 产物可查看。' }) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '对话中心' }).click()
  await expect(page.getByRole('combobox', { name: '最近对话' })).toHaveValue(sessionId)
  const mainCanvas = page.locator('.office-main canvas')
  await expect(mainCanvas).toBeVisible()
  const mainCanvasBox = await mainCanvas.boundingBox()

  const created = await request.post(`${gatewayOrigin}/actions`, {
    data: [
      { type: 'set_state', workspaceId: 'research-agent', workspaceName: '旅行研究 Agent', parentWorkspaceId: sessionId, sessionId, rosterNo: 2, state: 'working', task: '整理旅行资料' },
      { type: 'set_state', workspaceId: 'writer-agent', workspaceName: '方案撰写 Agent', parentWorkspaceId: sessionId, sessionId, rosterNo: 4, state: 'working', task: '撰写方案' },
    ],
  })
  expect(created.status()).toBe(202)
  await expect(page.getByRole('button', { name: '空间总览' })).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('输入下一条消息').fill('空间总览切换后仍需保留的草稿')
  await page.getByRole('button', { name: '空间总览' }).click()
  const cards = page.locator('.agent-space-card')
  await expect(cards).toHaveCount(3)
  await expect(page.locator('.office-header-stats')).toHaveCount(0)
  await expect(page.locator('.office-right-panel')).toBeHidden()
  await expect(cards.filter({ hasText: '我的空间' }).locator('.office-canvas canvas')).toBeVisible()
  await expect(page.locator('.agent-space-card').filter({ hasText: '旅行研究' }).locator('canvas')).toBeVisible()
  await expect(page.locator('.agent-space-card').filter({ hasText: '方案撰写' }).locator('canvas')).toBeVisible()
  const canvases = cards.locator('.office-canvas canvas')
  await expect(canvases).toHaveCount(3)
  await expect.poll(async () => canvases.evaluateAll((elements) => elements.map((element) => {
    const target = element as HTMLCanvasElement
    const context = target.getContext('webgl2') || target.getContext('webgl')
    if (!context) return 0
    const pixels = new Uint8Array(target.width * target.height * 4)
    context.readPixels(0, 0, target.width, target.height, context.RGBA, context.UNSIGNED_BYTE, pixels)
    return pixels.some((channel) => channel !== 0) ? 1 : 0
  }))).toEqual([1, 1, 1])
  const canvasBoxes = await canvases.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.round(box.height) }
  }))
  expect(new Set(canvasBoxes.map((box) => `${box.width}x${box.height}`)).size).toBe(1)
  await canvases.evaluateAll((elements) => elements.forEach((element, index) => element.setAttribute('data-e2e-instance', `workspace-canvas-${index}`)))
  const workspaceScroller = page.locator('.workspace-scene-layer')
  for (let index = 0; index < 20; index += 1) {
    await workspaceScroller.evaluate((element, toBottom) => element.scrollTo({ top: toBottom ? element.scrollHeight : 0 }), index % 2 === 0)
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
  await expect(canvases).toHaveCount(3)
  expect(await canvases.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-e2e-instance')))).toEqual([
    'workspace-canvas-0',
    'workspace-canvas-1',
    'workspace-canvas-2',
  ])

  const researchCard = cards.filter({ hasText: '旅行研究' })
  await researchCard.getByRole('button', { name: '查看旅行研究输出' }).click()
  await expect(page.getByRole('dialog', { name: '旅行研究输出记录' })).toContainText('李研 · 整理旅行资料')
  await page.getByRole('heading', { name: '多 Agent 空间总览' }).click()
  await expect(page.getByRole('dialog', { name: '旅行研究输出记录' })).toBeHidden()
  const artifactShelf = researchCard.getByRole('button', { name: /打开当前协作空间的产物货架/ })
  await expect(artifactShelf).toBeEnabled()
  await artifactShelf.click()
  await expect(page.getByText('研究产物.md')).toHaveCount(0)
  await page.getByRole('button', { name: /研究产物/ }).click()
  await expect(page.locator('.office-main .artifact-focus-view.is-workspace-artifact')).toBeVisible()
  await expect(page.locator('.office-right-panel')).toBeVisible()
  await expect(page.getByRole('button', { name: '旅行研究', exact: true })).toHaveAttribute('aria-current', 'true')
  await expect(
    page
      .getByRole('main', { name: '查看产物 研究产物' })
      .getByRole('heading', { name: '研究产物', level: 2 }),
  ).toBeVisible()
  await page.getByRole('button', { name: '关闭产物' }).click()

  await page.getByRole('button', { name: '空间总览' }).click()
  await expect(page.locator('.agent-space-card')).toHaveCount(3)
  await cards.filter({ hasText: '方案撰写' }).locator('.agent-space-canvas').click({ position: { x: 8, y: 8 } })
  const childCanvas = page.locator('.workspace-scene-layer .single-agent-workspace > .office-canvas canvas')
  await expect(childCanvas).toBeVisible()
  await expect(page.getByText('SUB AGENT')).toHaveCount(0)
  const childCanvasBox = await childCanvas.boundingBox()
  expect(childCanvasBox?.width).toBeCloseTo(mainCanvasBox?.width ?? 0, 0)
  expect(childCanvasBox?.height).toBeCloseTo(mainCanvasBox?.height ?? 0, 0)
  await page.getByRole('button', { name: '空间总览' }).click()
  await expect(page.locator('.agent-space-card')).toHaveCount(3)
  expect(sceneWarnings).toEqual([])

  const accepted = await request.post(`${gatewayOrigin}/actions`, {
    data: [
      { type: 'workspace_handoff', sessionId, fromWorkspaceId: sessionId, toWorkspaceId: 'research-agent', phase: 'going', rosterNo: 5, message: '主 Agent 正在向研究 Agent 交付资料' },
      { type: 'workspace_handoff', sessionId, fromWorkspaceId: sessionId, toWorkspaceId: 'writer-agent', phase: 'going', rosterNo: 5, message: '主 Agent 正在向撰写 Agent 交付资料' },
    ],
  })
  expect(accepted.status()).toBe(202)
  await expect(page.getByLabel('主 Agent 正在向研究 Agent 交付资料')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('主 Agent 正在向撰写 Agent 交付资料')).toBeVisible()
  await expect(page.locator('.space-handoff-dots')).toHaveCount(2)
  await expect(page.locator('.space-handoff-person')).toHaveCount(0)

  const completed = await request.post(`${gatewayOrigin}/actions`, {
    data: { type: 'workspace_handoff', sessionId, fromWorkspaceId: sessionId, toWorkspaceId: 'research-agent', phase: 'complete' },
  })
  expect(completed.status()).toBe(202)
  await expect(page.getByLabel('主 Agent 正在向研究 Agent 交付资料')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByLabel('主 Agent 正在向撰写 Agent 交付资料')).toBeVisible()
  const completedSecond = await request.post(`${gatewayOrigin}/actions`, {
    data: { type: 'workspace_handoff', sessionId, fromWorkspaceId: sessionId, toWorkspaceId: 'writer-agent', phase: 'complete' },
  })
  expect(completedSecond.status()).toBe(202)
  await expect(page.getByLabel('主 Agent 正在向撰写 Agent 交付资料')).toHaveCount(0, { timeout: 10_000 })

  await page.getByRole('button', { name: '任务中心' }).click()
  await expect(page.locator('.office-right-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible()
  await page.getByRole('button', { name: '对话中心' }).click()
  await expect(page.locator('.office-right-panel')).toBeHidden()
  await page.getByRole('button', { name: '我的空间', exact: true }).click()
  await expect(page.locator('.office-right-panel')).toBeVisible()
  await expect(page.getByLabel('输入下一条消息')).toHaveValue('空间总览切换后仍需保留的草稿')
})
