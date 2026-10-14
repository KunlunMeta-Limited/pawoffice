/**
 * 功能：定义 AI Office E2E 测试的目录、端口、浏览器和 Gateway/Vite 启动边界。
 * 数据来源：环境变量和 Playwright 默认设备；数据去向：测试运行器启动的临时服务。
 * 约束：Gateway 与 Vite 使用隔离端口；测试数据写入 `test-results`，不得使用生产 home 或工作区。
 * 并发与取消：Playwright 负责回收 Gateway 子进程，服务启动失败必须阻断验收。
 * 关联：`TEST-AIOFFICE-E2E-001`、`CHG-2026-0004`。
 */
import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { resolve } from 'node:path'

const browserCandidates = [
  process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((candidate): candidate is string => Boolean(candidate) && existsSync(candidate))

const gatewayPort = process.env.OFFICE_ACTION_GATEWAY_PORT || '8765'
const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`
// 4173 在启用 Hyper-V/WSL 的 Windows 上常落入系统保留区间；4397 仍可由环境变量覆盖。
const vitePort = process.env.OFFICE_E2E_VITE_PORT || '4397'
const viteOrigin = `http://127.0.0.1:${vitePort}`
const servicesManagedExternally = process.env.OFFICE_E2E_MANAGED_SERVERS === '1'
const runRoot = process.env.OFFICE_E2E_RUN_ROOT || resolve(os.tmpdir(), `ai-office-playwright-${process.pid}`)
const openpawHome = resolve(runRoot, 'openpaw-home')
const officeWorkspace = resolve(runRoot, 'office-workspace')
const outputDir = process.env.OFFICE_E2E_OUTPUT_DIR || resolve(runRoot, 'playwright-output')

/**
 * 功能：导出 AI Office 浏览器系统测试配置，并按需托管隔离的 Gateway 与 Vite 进程。
 * 字段语义：`testDir` 指向生产链路 E2E；`use` 固定浏览器与 baseURL；`webServer` 定义测试服务生命周期。
 * 数据来源：当前进程环境变量、可用浏览器路径和仓库内测试脚本。
 * 数据去向：Playwright 测试运行器及其子进程管理器。
 * 错误：浏览器不存在、端口占用或服务健康检查失败时由 Playwright 阻断测试。
 * 约束：测试 home、workspace 和端口必须与生产环境隔离，不得复用未知旧进程。
 * 并发与取消：Playwright 负责启动、等待和回收子进程；外部托管模式下不重复启动服务。
 * 权限：仅绑定回环地址，测试数据只写入 `test-results`。
 * 稳定性：E2E 基础设施配置，端口和路径变化必须同步测试脚本。
 * 关联：`TEST-AIOFFICE-E2E-001`、`CHG-2026-0004`。
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
  timeout: 30_000,
  use: {
    baseURL: viteOrigin,
    ...devices['Desktop Chrome'],
    launchOptions: {
      ...(browserCandidates[0] ? { executablePath: browserCandidates[0] } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: servicesManagedExternally ? undefined : [
    {
      // Playwright 负责拥有并在测试结束后终止 Gateway 进程。
      // 测试可以选择隔离端口，不改变生产默认端口。
      // 直接启动 Node 进程，确保 Playwright 能可靠回收。
      // npm 包装命令在失败后可能留下子进程，导致下一次验收复用同一端口失败。
      command: 'node scripts/action-gateway.mjs',
      url: `${gatewayOrigin}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        OFFICE_ACTION_GATEWAY_PORT: gatewayPort,
        OFFICE_ALLOWED_ORIGINS: viteOrigin,
        OPENPAW_HOME: openpawHome,
        OPENPAW_OFFICE_WORKSPACE: officeWorkspace,
      },
    },
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${vitePort}`,
      url: viteOrigin,
      // 旧 Vite 可能指向不同 Gateway；复用会污染数据并产生假通过。
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_OFFICE_HTTP_ACTIONS_URL: `${gatewayOrigin}/actions`,
      },
    },
  ],
})
