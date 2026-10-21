import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArtifactHtmlPreview } from '@/components/ArtifactHtmlPreview'
import { AssistantText } from '@/components/AssistantText'

describe('HTML 通用预览', () => {
  it('阅读模式移除脚本和作者样式并应用统一中文排版', () => {
    render(<ArtifactHtmlPreview compact html={'<style>h1{color:red}</style><h1 style="font-size:72px">报告</h1><script>parent.__unsafe = true</script><form action="https://example.com"><button>提交</button></form>'} />)
    const frame = screen.getByTitle('HTML 阅读预览')
    expect(frame).toHaveAttribute('sandbox', '')
    const source = frame.getAttribute('srcdoc') || ''
    expect(source).toContain('Content-Security-Policy')
    expect(source).toContain("script-src 'none'")
    expect(source).toContain("form-action 'none'")
    expect(source).toContain("connect-src 'none'")
    expect(source).toContain('<h1>报告</h1>')
    expect(source).toContain('Microsoft YaHei UI')
    expect(source).toContain('width:min(calc(100% - 32px),920px)')
    expect(source).toContain('font-size:16px')
    expect(source).toContain('font-size:14px;line-height:1.65')
    expect(source).not.toContain('color:red')
    expect(source).not.toContain('font-size:72px')
    expect(source).not.toContain('<script')
    expect(source).not.toContain('<form')
  })

  it('独立 HTML 默认在不透明源原页中保留作者样式、脚本和 HTTPS 资源', () => {
    render(<ArtifactHtmlPreview html={'<link rel="stylesheet" href="https://cdn.example.test/map.css"><button onclick="window.clicked=true">运行</button><script src="https://cdn.example.test/map.js"></script><iframe src="https://example.test"></iframe><form action="https://example.test"></form>'} />)
    const frame = screen.getByTitle('HTML 原页预览')
    expect(screen.getByRole('button', { name: '原页' })).toHaveAttribute('aria-pressed', 'true')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    const source = frame.getAttribute('srcdoc') || ''
    expect(source).toContain("script-src 'unsafe-inline' https:")
    expect(source).toContain("style-src 'unsafe-inline' https:")
    expect(source).toContain('connect-src https:')
    expect(source).toContain("form-action 'none'")
    expect(source).toContain('onclick="window.clicked=true"')
    expect(source).toContain('src="https://cdn.example.test/map.js"')
    expect(source).toContain('<form action="https://example.test"></form>')
    expect(source).not.toContain('<iframe')
  })

  it('可重新挂载原页 iframe，并在离开原页时卸载页面', () => {
    render(<ArtifactHtmlPreview html={'<main>交互内容</main>'} />)
    const firstFrame = screen.getByTitle('HTML 原页预览')
    fireEvent.click(screen.getByRole('button', { name: '重新加载原页' }))
    expect(screen.getByTitle('HTML 原页预览')).not.toBe(firstFrame)
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(screen.queryByTitle('HTML 原页预览')).not.toBeInTheDocument()
  })

  it('可在预览和转义源码之间切换并容错不完整 HTML', () => {
    render(<ArtifactHtmlPreview compact html={'<main><strong>未闭合'} />)
    expect(screen.getByTitle('HTML 阅读预览')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(screen.getByText('<main><strong>未闭合')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '阅读模式' }))
    expect(screen.getByTitle('HTML 阅读预览')).toBeInTheDocument()
  })

  it('在智能体回复中把 html 代码块渲染为紧凑预览', () => {
    render(<AssistantText text={'结果如下：\n```html\n<section><h2>路线卡片</h2></section>\n```'} />)
    expect(screen.getByTitle('HTML 阅读预览')).toBeInTheDocument()
    expect(screen.getByLabelText('HTML 内容')).toHaveClass('is-compact')
  })

  it('包含地图结构的 HTML 仍使用通用原页和阅读模式', () => {
    render(<ArtifactHtmlPreview html={'<style>#map{height:100vh}</style><main id="map"></main><script>const ROUTES=[{name:"路线",stops:[{n:"甲",lat:23.1,lng:113.2},{n:"乙",lat:23.2,lng:113.3}]}];window.__unsafe=true</script>'} />)
    expect(screen.getByTitle('HTML 原页预览')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '路线地图' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '阅读模式' }))
    const frame = screen.getByTitle('HTML 阅读预览')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame.getAttribute('srcdoc')).not.toContain('动态地图脚本已安全隔离')
    expect(frame.getAttribute('srcdoc')).not.toContain('#map{height:100vh}')
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(screen.getByText(/window\.__unsafe/)).toBeInTheDocument()
  })
})
