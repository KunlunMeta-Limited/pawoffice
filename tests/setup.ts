import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}

// 每个测试文件都显式清理 DOM、全局替身和计时器，避免真实异步任务把状态带入下一文件。
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
