import type { MemberProfileProps } from '../ui/memberProfilePresentation.ts'
import './CommerceMemberProfile.css'

const profiles = {
  'office-lead': {
    duty: '负责本轮商品上架的派工、验收与发布把关，协调商品运营、页面质检和发布登记。',
    heading: '本轮把关重点',
    points: ['售价保持 79 元，价格调整需单独确认。', '标题、主图和详情统一六档调节、折叠收纳及 13–16 英寸口径。', '后台只读访问与上架发布分别授权，复核完成后再提交发布。'],
    recordHeading: '协作安排',
    records: ['陈书核对后台商品资料与售价，形成上架资料口径。', '周理检查图文一致性、尺寸说明与手机端阅读。', '赵审申请本次上架确认，并登记结果与后续观察事项。'],
  },
  'code-agent': {
    duty: '协助核验商品资料，给运营和质检提供可引用的参数口径，标出未验证的信息。',
    heading: '商品资料核验',
    points: ['规格卡：六档调节、折叠收纳，标注适用 13–16 英寸笔记本。', '适配答疑：屏幕英寸相同仍需核对机身宽深、支撑面和前挡板。', '17 英寸适配、承重数值与各档高度没有验证资料，不写入商品承诺。'],
    recordHeading: '资料交接记录',
    records: ['向陈书提供核对清单：售价、调节结构、收纳方式、适用范围。', '给周理标出质检重点：尺寸说明与实拍画面逐项对应。', '待补材料：17 英寸机型验证、承重测试与展开尺寸测量。'],
  },
  'file-agent': {
    duty: '负责上架页面质检，逐项检查标题、主图、详情和尺寸提示，将可发布版本交给赵审。',
    heading: '页面检查清单',
    points: ['标题与价格：商品名称清晰，售价为 79 元，规格用词一致。', '主图与详情：展示支架全貌、六档结构和折叠状态，图片与文字对应。', '尺寸与手机端：13–16 英寸提示可见，参数、图注和购买前核对说明可读。'],
    recordHeading: '验收与交接要求',
    records: ['先接收陈书核对后的商品资料，再对照页面逐项检查。', '发现图文不一致时记录具体位置及修改建议，不带问题进入发布。', '复核通过后交给赵审申请上架，授权前保留草稿状态。'],
  },
} as const

export function renderCommerceMemberProfile({ dashboard, employeeId, expanded }: MemberProfileProps) {
  if (dashboard.workspace.id !== 'office-1' || dashboard.conversationId !== 'main' || !Object.hasOwn(profiles, employeeId)) return null
  const profile = profiles[employeeId as keyof typeof profiles]
  const [product, review, listing] = dashboard.tasks
  const focus = listing?.status === 'completed'
    ? '本轮上架登记已完成，可在白板查看交付成果；后续记录访问、订单与适配咨询。'
    : listing?.status === 'running'
      ? '本次上架已获确认，赵审正在登记发布结果与后续观察事项。'
      : review?.status === 'completed'
        ? '商品资料与页面已复核，尚未登记上架结果；按 79 元发布需单独确认。'
        : review?.status === 'running'
          ? '周理正在复核上架页面，重点核对图文和尺寸说明，完成后交给赵审。'
          : product?.status === 'completed'
            ? '商品资料与售价已核对，正在衔接周理的页面复核。'
            : product?.status === 'blocked'
              ? '陈书正在等待店铺资料的只读访问授权，核价和发布尚未完成。'
              : product?.status === 'running'
                ? '陈书正在核对后台售价与商品规格，李研协助确认参数来源。'
                : '本轮资料与检查清单已准备，等待陈书接到任务后核对后台商品与售价。'
  return <div className="commerce-member-profile" data-expanded={expanded} aria-label="电商案例成员详情">
    <section><h3>本轮职责</h3><p>{profile.duty}</p></section>
    <section className="commerce-member-focus"><h3>当前跟进</h3><p>{focus}</p></section>
    <section><h3>{profile.heading}</h3><ul>{profile.points.slice(0, expanded ? undefined : 2).map(point => <li key={point}>{point}</li>)}</ul></section>
    <section><h3>{profile.recordHeading}</h3><ol>{profile.records.slice(0, expanded ? undefined : 2).map(record => <li key={record}>{record}</li>)}</ol></section>
    {expanded && <p className="commerce-member-footnote">本地电商案例资料 · 折叠电脑支架上架准备</p>}
  </div>
}
