import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))

export default defineConfig({
  testDir: '.', testMatch: 'whiteboard-browser.spec.mjs', workers: 1, fullyParallel: false, retries: 0,
  timeout: 120000, expect: { timeout: 15000 }, outputDir: '../test-results/whiteboard-browser', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5187', channel: process.env.PAWOFFICE_E2E_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true, viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] } },
  webServer: [
    { command: 'node server/dist/index.js', cwd, url: 'http://127.0.0.1:5188/health', timeout: 30000, reuseExistingServer: false,
      env: { PORT: '5188', HOST: '127.0.0.1', PAWOFFICE_API_KEY: 'whiteboard-local-test-key', PAWOFFICE_SERVE_STATIC: 'false' } },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort', cwd, url: 'http://127.0.0.1:5187', timeout: 30000, reuseExistingServer: false,
      env: { PAWOFFICE_INTERNAL_API_URL: 'http://127.0.0.1:5188' } },
  ],
})
