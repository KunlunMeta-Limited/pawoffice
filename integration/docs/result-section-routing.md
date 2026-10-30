# 成果内容用途与归属

协议约束数据形状，前端按用途归位，不限定业务模板。现有文本、图表、表格、Mermaid等通用块继续使用。

| 区域 | 内容 |
| --- | --- |
| 概览 | 结论、指标、任务摘要、分析与来源；未分类旧内容进入“补充内容” |
| 交付物 | result.artifacts独立产物列表，以及kind: changes文件变更 |
| 文件预览 | 指定产物版本的结构化内容或原始正文/图片 |
| 过程记录 | 验收、验证依据、任务详情、风险、决策 |

概览的文件变化仅显示摘要和入口。图片从对应产物打开。图表既可作为分析，也可作为报告内容，由明确用途决定。

## 可选字段与校验

所有section新增以下可选字段，原有kind及内容块不变。

| 字段 | 约定 |
| --- | --- |
| purpose | analysis进入概览；evidence进入过程记录；artifact-preview进入关联产物预览。省略或空串为旧内容未分类 |
| artifactId | 来源或预览载体的产物ID，不按标题匹配 |
| versionId | 确定版本，与artifactId成对填写 |

artifact-preview必须提供ID和版本，并在**同一条result.artifacts中唯一匹配**。分析和依据不强制关联文件，但一旦填写来源，同样要求有效的精确关联。历史交付可将引用到的未变文件以change: unchanged加入列表，无需重复正文，可继续使用版本URL。

kind: changes固定在交付物，省略purpose。kind: tests固定在过程记录，purpose省略或为evidence。矛盾归属、未知用途、缺少或错位的明确关联会被Schema拒绝。新字段不接受任意HTML、CSS或组件。

## 示例

以下分析进入概览，来源按钮打开预算v3；本条result必须同时包含预算v3产物。

```json
{
  "kind":"custom", "id":"budget-analysis", "title":"推广预算分析",
  "purpose":"analysis", "artifactId":"budget", "versionId":"budget-v3",
  "blocks":[{"type":"chart", "chart":"pie", "unit":"元", "series":[
    {"label":"首轮","value":360},{"label":"优化","value":980},{"label":"收尾","value":460}
  ]}]
}
```

报告的内容则放入文件预览：

```json
{
  "artifacts":[{
    "id":"report", "versionId":"report-v2", "title":"经营报告.md", "version":"v2",
    "mimeType":"text/markdown", "url":"https://business.example/versions/report-v2/content"
  }],
  "sections":[{
    "kind":"custom", "id":"report-body", "title":"报告内容",
    "purpose":"artifact-preview", "artifactId":"report", "versionId":"report-v2",
    "blocks":[{"type":"text","text":"## 结论\n\n继续观察，暂不扩量。"}]
  }]
}
```

交付物只列报告。打开后显示关联内容，可切换“文件正文”，下载仍使用原始版本字节。选择v1只寻找v1预览，缺少时展示v1正文，不套用v2内容。原件读取或哈希校验失败，不会被结构化预览掩盖。

独立结构化报告也可只有产物ID、版本和关联内容，不强迫创建实体文件。未提供原件时可阅读，但原件下载明确禁用，不虚构哈希校验通过。业务后端负责版本正文与预览内容一致，前端不从图表反向生成源文件。

## 检查和兼容

新后端推荐只在result.checks维护正式检查。旧tests检查继续接收，汇入同一验收清单。按id + artifactId + versionId去重；冲突状态按未通过、待补充、已通过的顺序保守处理。不同检查或版本不会因名称相同而合并；失效版本仍提示待核对。原始输入不改写，Markdown报告使用相同归属规则。

没有新字段的旧请求继续有效：变更和检查按类型归位；已关联的旧文档/附件元数据继续合并至文件卡片；其余区块保留在概览“补充内容”。不猜测，不丢弃。

新字段需要新版接收服务，请按原来的npm run dev与npm run integration-ui-example重启后再启动mock，运行方式不变。

```powershell
pwsh -NoProfile -File .\integration\clients\start-workflow-mock.ps1 -Mode showcase
```

主电商会话检查：交付物只有7个产物及文件变更；概览的预算图与复盘可以打开来源；文案v2/v1只展示自身预览；构图从SVG文件打开；过程记录的3项正式检查只出现一次。
