import { useMemo } from 'react'

/**
 * 功能：以统一结构展示 JSON 正文，并在格式损坏时保留原文和明确警告。
 * 参数：content 为待展示的 UTF-8 JSON 文本。
 * 返回：返回只读 React 预览界面。
 * 错误：解析失败时不抛异常，按原文显示。
 * 状态：只根据输入计算格式化结果，无持久状态。
 * 并发与取消：无异步操作，不涉及取消。
 * 权限：不执行 JSON 内容，不访问文件系统或网络。
 * 关联：供文件中心和对话产物查看器复用。
 */
export function ArtifactJsonPreview({ content }: { content: string }) {
  const preview = useMemo(() => {
    try {
      return { formatted: JSON.stringify(JSON.parse(content), null, 2), invalid: false }
    } catch {
      return { formatted: content, invalid: true }
    }
  }, [content])

  return <div className="json-document">
    {preview.invalid
      ? <p className="data-state data-state-warning">JSON 格式不完整，已按原文显示</p>
      : <div className="json-document-heading"><strong>结构化 JSON</strong><span>已格式化</span></div>}
    <pre>{preview.formatted}</pre>
  </div>
}
