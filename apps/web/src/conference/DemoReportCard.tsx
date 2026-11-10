import { BarChart3, FileText } from 'lucide-react'
import type { DemoReport } from './demoReports.ts'
import './DemoReportCard.css'

export function DemoReportCard({ report }: { report: DemoReport }) {
  const { chart } = report
  const max = Math.max(1, ...chart.rows.map(row => row.value))
  return <section className="demo-office-report" data-tone={report.tone} aria-label={report.title}>
    <header className="demo-report-header">
      <div className="demo-report-masthead"><span><FileText size={14} aria-hidden="true" />{report.scope}</span><span className="demo-report-status">{report.status}</span></div>
      <h2>{report.title}</h2>
      <p>{report.summary}</p>
    </header>
    <dl className="demo-report-metrics" aria-label="关键指标">
      {report.metrics.map(metric => <div key={metric.label}>
        <dt>{metric.label}</dt><dd>{metric.value}<small>{metric.detail}</small></dd>
      </div>)}
    </dl>
    <div className="demo-report-body">
      <figure className="demo-report-chart">
        <figcaption><BarChart3 size={16} aria-hidden="true" />{chart.title}<span>单位 {chart.unit}</span></figcaption>
        <ul className="demo-report-bars" aria-label={chart.title}>
          {chart.rows.map(row => <li key={row.label}>
            <div className="demo-report-bar-track">
              <strong>{row.value.toLocaleString('zh-CN')}{chart.unit === '%' ? '%' : ''}</strong>
              <span aria-hidden="true" style={{ height: `${row.value / max * 76}%` }} />
            </div>
            <span className="demo-report-bar-label">{row.label}</span>
          </li>)}
        </ul>
      </figure>
      <section className="demo-report-findings">
        <h3>主要发现</h3>
        <ol>{report.findings.map(item => <li key={item.title}><strong>{item.title}</strong><p>{item.detail}</p></li>)}</ol>
      </section>
    </div>
    <footer className="demo-report-footer">
      <div><strong>下一步</strong><p>{report.next}</p></div>
      <small>{report.note}</small>
    </footer>
  </section>
}
