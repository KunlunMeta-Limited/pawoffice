import { useEffect, useMemo, useState } from 'react'

type HtmlViewMode = 'web' | 'reader' | 'source'

function prependPolicy(document: Document, directives: string[]) {
  document.querySelectorAll('meta[http-equiv]').forEach((element) => element.remove())
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = directives.join('; ')
  document.head.prepend(policy)
}

function ensureViewport(document: Document) {
  if (document.querySelector('meta[name="viewport"]')) return
  const viewport = document.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  document.head.append(viewport)
}

function webDocument(source: string) {
  const parser = new DOMParser()
  const document = parser.parseFromString(source, 'text/html')
  document.querySelectorAll('iframe, frame, frameset, object, embed, base').forEach((element) => element.remove())
  document.querySelectorAll('[srcdoc]').forEach((element) => element.removeAttribute('srcdoc'))
  prependPolicy(document, [
    "default-src 'none'",
    "script-src 'unsafe-inline' https:",
    "style-src 'unsafe-inline' https:",
    'img-src data: blob: https:',
    'font-src data: https:',
    'connect-src https:',
    'media-src data: blob: https:',
    'worker-src blob:',
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ])
  ensureViewport(document)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

function readerDocument(source: string) {
  const parser = new DOMParser()
  const document = parser.parseFromString(source, 'text/html')
  document.querySelectorAll('script, iframe, frame, frameset, object, embed, form, base, style, link, meta[http-equiv]').forEach((element) => element.remove())
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase()
      const value = attribute.value.trim().toLocaleLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style') element.removeAttribute(attribute.name)
      else if (['href', 'action', 'formaction', 'poster', 'data'].includes(name)) element.removeAttribute(attribute.name)
      else if (name === 'src' && !value.startsWith('data:')) element.removeAttribute(attribute.name)
    }
  })
  prependPolicy(document, [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "media-src data:",
    "script-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ])
  ensureViewport(document)
  const defaults = document.createElement('style')
  defaults.textContent = ':root{color-scheme:light;font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",system-ui,sans-serif;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box;letter-spacing:0}html{min-height:100%;background:#eef1f3;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{width:min(calc(100% - 32px),920px);min-height:calc(100vh - 48px);margin:24px auto;padding:clamp(24px,5vw,56px);overflow-wrap:anywhere;color:#20262b;background:#fff;font-size:16px;line-height:1.75;box-shadow:0 8px 30px rgba(35,45,52,.08)}h1,h2,h3,h4,h5,h6{margin:1.45em 0 .6em;color:#182027;line-height:1.28}h1:first-child,h2:first-child,h3:first-child{margin-top:0}h1{font-size:30px}h2{font-size:23px;padding-bottom:.35em;border-bottom:1px solid #e4e8eb}h3{font-size:19px}p,ul,ol,blockquote,pre,table,figure{margin:0 0 1.15em}ul,ol{padding-left:1.55em}li+li{margin-top:.28em}a{color:#176b98;text-decoration-thickness:1px;text-underline-offset:3px}strong{color:#182027}blockquote{padding:10px 16px;border-left:3px solid #79a8bf;background:#f4f8fa;color:#4a5961}img,svg,video,canvas{display:block;max-width:100%;height:auto;margin:18px auto}table{display:block;width:100%;max-width:100%;overflow:auto;border-collapse:collapse;font-size:14px;line-height:1.65}th,td{min-width:110px;padding:10px 12px;border:1px solid #dfe4e7;text-align:left;vertical-align:top}th{background:#f3f6f7;font-weight:700}pre{max-width:100%;padding:16px;overflow:auto;border:1px solid #e0e5e7;border-radius:6px;background:#f6f8f9;white-space:pre-wrap}code{font-family:Consolas,"Cascadia Mono",monospace;font-size:14px;line-height:1.65}hr{margin:28px 0;border:0;border-top:1px solid #dfe4e7}@media(max-width:620px){body{width:100%;min-height:100vh;margin:0;padding:22px 18px;box-shadow:none}h1{font-size:25px}h2{font-size:20px}}'
  document.head.append(defaults)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

/**
 * 功能：以通用原页、统一阅读和源码三种方式隔离展示 HTML；参数：HTML 正文和紧凑模式。
 * 返回：不针对业务内容分支的 HTML React 界面；错误：畸形 HTML 由浏览器容错，外部资源失败可重新加载。
 * 状态：维护查看模式和原页 iframe 刷新序号；并发与取消：模式切换时卸载 iframe 并终止其中任务。
 * 权限：原页 iframe 仅允许脚本且保持不透明源，阅读 iframe 无授权；关联：对话、文件和产物。
 */
export function ArtifactHtmlPreview({ html, compact = false }: { html: string; compact?: boolean }) {
  const initialMode = compact ? 'reader' : 'web'
  const [mode, setMode] = useState<HtmlViewMode>(initialMode)
  const [webVersion, setWebVersion] = useState(0)
  const webSrcDoc = useMemo(() => webDocument(html), [html])
  const readerSrcDoc = useMemo(() => readerDocument(html), [html])
  useEffect(() => {
    setMode(initialMode)
    setWebVersion(0)
  }, [html, initialMode])

  return <section className={`artifact-html-preview${compact ? ' is-compact' : ''}`} aria-label="HTML 内容">
    <header>
      <strong>HTML</strong>
      <div role="group" aria-label="HTML 查看方式">
        {!compact ? <button type="button" aria-pressed={mode === 'web'} onClick={() => setMode('web')}>原页</button> : null}
        <button type="button" aria-pressed={mode === 'reader'} onClick={() => setMode('reader')}>阅读模式</button>
        <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>源码</button>
        {mode === 'web' ? <button className="artifact-html-reload" type="button" aria-label="重新加载原页" title="重新加载原页" onClick={() => setWebVersion((value) => value + 1)}><span aria-hidden="true">↻</span></button> : null}
      </div>
    </header>
    {mode === 'web' ? <iframe key={webVersion} title="HTML 原页预览" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={webSrcDoc} /> : null}
    {mode === 'reader' ? <iframe title="HTML 阅读预览" sandbox="" referrerPolicy="no-referrer" srcDoc={readerSrcDoc} /> : null}
    {mode === 'source' ? <pre><code>{html}</code></pre> : null}
  </section>
}
