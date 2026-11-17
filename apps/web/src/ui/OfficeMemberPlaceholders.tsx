import { useState } from 'react'
import { PanelLeftClose, Plus } from 'lucide-react'
import { maxOfficeMembers } from '@pawoffice/protocol/dashboard'

const members = Array.from({ length: maxOfficeMembers }, (_, index) => `成员 ${String(index + 1).padStart(2, '0')}`)

export function QuestionAvatar({ height }: { height: number }) {
  return <span className="runtime-avatar member-placeholder-avatar" aria-hidden="true" style={{ width: height, height, fontSize: height * .55 }}>?</span>
}

export function OfficeMemberPlaceholders({ titleId, onCloseDrawer }: { titleId: string; onCloseDrawer: () => void }) {
  const [selected, setSelected] = useState(0)
  return <>
    <section className="member-roster" aria-labelledby={titleId}>
      <div className="member-roster-heading"><h2 id={titleId}>团队成员 <span>（{members.length}）</span></h2>
        <button className="member-add-button" type="button" title="等待办公室初始化" aria-label="添加成员" disabled><Plus size={15} strokeWidth={1.8} /></button>
        <button type="button" className="member-icon-button member-drawer-close" title="收起成员侧栏" aria-label="收起成员侧栏" onClick={onCloseDrawer}><PanelLeftClose size={18} /></button>
      </div>
      <div className="member-roster-grid">{members.map((name, index) => <button key={name} type="button" className="member-roster-person" data-placeholder="true"
        aria-label={`查看${name}的介绍`} aria-pressed={selected === index} onClick={() => setSelected(index)}>
        <span className="member-portrait"><QuestionAvatar height={46} /></span><strong>{name}</strong>
      </button>)}</div>
    </section>
    <hr className="member-roster-divider" aria-hidden="true" />
    <section className="member-detail" aria-label="成员资料" aria-live="polite">
      <div className="member-detail-summary"><header className="member-profile-heading"><QuestionAvatar height={52} /><div>
        <h2>{members[selected]}</h2><span className="member-profile-role">等待分配</span>
      </div></header></div>
      <div className="member-detail-scroll"><section className="member-placeholder-intro"><h3>成员介绍</h3>
        <p>办公室初始化后，这里会显示这位成员的姓名、职责和工作介绍。</p>
      </section></div>
      <footer className="member-detail-footer member-placeholder-note">等待办公室初始化</footer>
    </section>
  </>
}
