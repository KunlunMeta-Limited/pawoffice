import { ArrowDown, ArrowUpRight, ChevronRight, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { OfficeResult, ResultSection, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { ResultArtifactList } from '../components/ResultArtifactList.tsx'
import { ResultDeliveryShell } from '../components/ResultDeliveryShell.tsx'
import { ResultMetrics } from '../components/ResultMetrics.tsx'
import { ResultReviewLog } from '../components/ResultReviewLog.tsx'
import { ResultSectionCard } from '../components/ResultSectionCard.tsx'
import { ResultVersionTimeline } from '../components/ResultVersionTimeline.tsx'
import { resultBoardChecks, resultBoardSections, resultDocumentMetadata } from '../results/board.ts'
import { resultReadingMode } from '../results/readingMode.ts'
import type { ResultBoardFixture } from './resultBoardFixtures.ts'
import './CompleteResultPreview.css'

function SectionList({ sections, result }: { sections: ResultSection[]; result: OfficeResult }) {
  return <div className="complete-section-list">
    {sections.map(section => <ResultSectionCard key={section.id} section={section} artifacts={result.artifacts} />)}
  </div>
}

function ReadingToolbar({ children }: { children?: ReactNode }) {
  return <header className="complete-toolbar">
    <div className="complete-brand">
      <img src={`${import.meta.env.BASE_URL}brand/icon.png`} alt="" />
      <strong>PawOffice</strong>
      <span>成果阅读</span>
    </div>
    {children && <nav className="complete-toolbar-links" aria-label="演示与记录">{children}</nav>}
  </header>
}

export function ResultScenarioIndex({ fixtures }: { fixtures: ResultBoardFixture[] }) {
  return <main className="result-workspace complete-result">
    <ReadingToolbar><a href="?fixture=complete">灰度验收综合样例</a></ReadingToolbar>
    <div className="complete-content complete-scenarios">
      <header className="complete-intro">
        <p className="complete-kicker">模拟业务数据</p>
        <h1>成果交付场景</h1>
        <p>打开任一场景，查看本轮结论、交付内容和接手事项。</p>
      </header>
      <ul>
        {fixtures.map(({ name, title, result }) => <li key={name}>
          <a href={`?fixture=${name}`}>
            <span className="complete-scenario-name">{title}</span>
            <span className="complete-scenario-verdict">{result.verdict}</span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </li>)}
      </ul>
    </div>
  </main>
}

export function CompleteResultPreview({ board, result, fixture }: { board: WhiteboardTaskBoardData; result: OfficeResult; fixture: string }) {
  const fact = resultReadingMode(result) === 'fact'
  return <main className="result-workspace complete-result">
    <ReadingToolbar>
      <a href="?examples=1">场景样例</a>
      {(fixture === 'complete' || fixture === 'complete-fact') && <a href={fact ? '?fixture=complete' : '?fixture=complete-fact'}>{fact ? '查看交付型' : '查看说明型'}</a>}
      <a href={`?fixture=${fixture}&view=all`}>完整记录 <ArrowUpRight size={14} aria-hidden="true" /></a>
    </ReadingToolbar>
    <ResultDeliveryShell board={board} result={result}>
      {() => <div className="complete-content">
        {fact ? <FactReport result={result} original={fixture === 'complete-fact'} /> : <DeliveryReport result={result} original={fixture === 'complete'} />}
        <footer className="complete-footer">{[result.team, result.owner].filter(Boolean).join(' · ')}</footer>
      </div>}
    </ResultDeliveryShell>
  </main>
}

function NextSteps({ result }: { result: OfficeResult }) {
  if (!result.next.length) return null
  return <section className="complete-section" aria-labelledby="complete-next-title">
    <header className="complete-section-heading"><h2 id="complete-next-title">接下来</h2></header>
    <ol className="complete-next">{result.next.map(item => <li key={item}>{item}</li>)}</ol>
  </section>
}

function FactReport({ result, original }: { result: OfficeResult; original: boolean }) {
  return <div className="complete-fact">
    <header className="complete-intro">
      <p className="complete-kicker"><span>说明型成果</span><span>模拟业务数据</span></p>
      <h1>{result.title.replace(/（纯事实型）$/, '')}</h1>
      <div className="complete-lead">
        <h2>{original ? '建议暂缓正式上线' : result.verdict}</h2>
        <p>{result.summary}</p>
        {original && result.verdict && <p className="complete-fact-verdict">{result.verdict}</p>}
      </div>
    </header>
    <section className="complete-section" aria-label="结论与依据">
      <SectionList sections={resultBoardSections(result)} result={result} />
    </section>
    <NextSteps result={result} />
  </div>
}

function DeliveryReport({ result, original }: { result: OfficeResult; original: boolean }) {
  const [title, round] = result.title.split('｜')
  const leadMetric = original ? result.metrics.find(metric => metric.id === 'test-pass')
    : result.metrics.find(metric => metric.emphasis === 'primary') ?? result.metrics[0]
  const checks = resultBoardChecks(result)
  const risks = result.risks.filter(risk => risk.status !== 'closed')
  const attention = original ? checks.filter(check => check.status === 'failed').map(check => check.label)
    : risks.length ? risks.map(risk => risk.title) : checks.filter(check => check.status !== 'passed').map(check => check.label)
  const sections = resultBoardSections(result)
  const tests = sections.filter(section => section.kind === 'tests')
  const quality = tests.find(section => section.kind === 'tests')
  const supporting = sections.filter(section => ['documents', 'gallery', 'custom'].includes(section.kind))
  const implementation = sections.filter(section => ['changes', 'api', 'environments', 'files'].includes(section.kind))
  const hasReview = checks.length > 0 || result.risks.length > 0 || tests.length > 0
  const hasMetricDetail = original || result.metrics.length > 1
  const hasAppendix = supporting.length > 0 || implementation.length > 0 || result.versions.length > 0

  return <>
    <header className="complete-intro">
      <p className="complete-kicker"><span>{round || '本轮交付'}</span><span>模拟业务数据</span></p>
      <h1>{title}</h1>
      <div className="complete-overview">
        <div className="complete-lead">
          <h2>{original ? '灰度已交付，正式上线暂缓' : result.verdict}</h2>
          <p>{original ? <>本轮交付了登录、验证码与会话安全升级。<br className="complete-desktop-break" />最终验收仍有两项阻断。</> : result.summary}</p>
          {leadMetric && <p className="complete-rate" data-tone={leadMetric.tone}>
            <strong>{leadMetric.value}{leadMetric.unit}</strong>
            <span>{leadMetric.label}
              {leadMetric.target && <span className="complete-rate-target"> / 目标 {leadMetric.target}</span>}
              {leadMetric.previous && <span className="complete-rate-target"> / 前值 {leadMetric.previous}</span>}
            </span>
          </p>}
          {quality && <ul className="complete-test-counts" aria-label="回归用例分布">
            {quality.metrics.map(metric => <li key={metric.id} data-tone={metric.tone}>{metric.label} {metric.value}</li>)}
          </ul>}
        </div>
        {attention.length > 0 && <aside className="complete-blockers" aria-label={original ? '发布阻断项' : '接手时注意'}>
          <h3><CircleAlert size={17} aria-hidden="true" />{original ? '上线前需解决' : '接手时注意'}</h3>
          <ul>{attention.map(item => <li key={item}>{item}</li>)}</ul>
          <a href="#complete-review">{original ? '查看验收依据' : '查看验证记录'} <ArrowDown size={14} aria-hidden="true" /></a>
        </aside>}
      </div>
    </header>

    {result.artifacts.length > 0 && <section className="complete-section complete-delivery" aria-labelledby="complete-delivery-title">
      <header className="complete-section-heading">
        <h2 id="complete-delivery-title">本轮交付</h2>
        <span>{result.artifacts.length} 份交付物</span>
      </header>
      <ResultArtifactList artifacts={result.artifacts} documentMeta={resultDocumentMetadata(result)} />
    </section>}

    {hasReview && <section id="complete-review" className="complete-section" aria-labelledby="complete-review-title">
      <header className="complete-section-heading"><h2 id="complete-review-title">{result.risks.length ? '验证与风险' : '验证记录'}</h2></header>
      <ResultReviewLog result={result} />
      {(tests.length > 0 || hasMetricDetail) && <details className="complete-disclosure">
        <summary><ChevronRight size={16} aria-hidden="true" />测试明细与全部指标</summary>
        {tests.length > 0 && <SectionList sections={tests} result={result} />}
        {hasMetricDetail && <ResultMetrics metrics={result.metrics} />}
      </details>}
    </section>}

    <NextSteps result={result} />

    {hasAppendix && <section className="complete-section" aria-labelledby="complete-details-title">
      <header className="complete-section-heading"><h2 id="complete-details-title">补充材料与记录</h2></header>
      {supporting.length > 0 && <details className="complete-disclosure">
        <summary><ChevronRight size={16} aria-hidden="true" />界面示意、交付目录与分析</summary>
        <SectionList sections={supporting} result={result} />
      </details>}
      {implementation.length > 0 && <details className="complete-disclosure">
        <summary><ChevronRight size={16} aria-hidden="true" />{original ? '代码变更、接口、环境与附件' : '查看实现变更'}</summary>
        <SectionList sections={implementation} result={result} />
      </details>}
      {result.versions.length > 0 && <details className="complete-disclosure">
        <summary><ChevronRight size={16} aria-hidden="true" />版本记录</summary>
        <ResultVersionTimeline result={result} releaseScopes={original ? { 'version-rc4': '受控灰度环境' } : undefined} />
      </details>}
    </section>}
  </>
}
