import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Braces, Download, Ellipsis, FileJson, PanelLeftClose, PanelLeftOpen, Plug, Plus, SlidersHorizontal, UserRound, X } from 'lucide-react'
import type { DashboardTask } from '@pawoffice/protocol/dashboard'
import { maxOfficeMembers, officeMemberLimitMessage } from '@pawoffice/protocol/dashboard'
import type { ScenePanel } from '../components/SceneControlPanel.tsx'
import { CharacterAvatar } from '../components/CharacterArtwork.tsx'
import { memberOverview, memberProgress, memberRoster, memberTaskStatuses, memberTime } from '../dashboard/memberSelectors.ts'
import { dashboardMetrics } from '../dashboard/selectors.ts'
import type { OfficeShellProps } from './OfficeShell.tsx'
import { AddOfficeMemberDialog } from './AddOfficeMemberDialog.tsx'
import { OfficeOverviewPresentation } from './officeOverviewPresentation.ts'
import { MemberProfilePresentation } from './memberProfilePresentation.ts'
import { OfficeMemberPlaceholders, QuestionAvatar } from './OfficeMemberPlaceholders.tsx'
import '../components/RuntimeWorkspace.css'
import './MemberOfficeShell.css'

function TaskProgress({ task }: { task: DashboardTask }) {
  return <div className="member-task-progress"><progress value={memberProgress(task)} max={100} aria-label={`${task.title}进度`} />
    <span>{task.status === 'completed' ? '100%' : task.progress === undefined || task.progress < 0 ? memberTaskStatuses[task.status] : `${Math.round(memberProgress(task))}%`}</span></div>
}

export function MemberOfficeShell({ dashboard, appearanceIds, scene, layoutControl, officeSwitcherRef, selectedEmployeeId, onSelectEmployee, connection, dataMode,
  rosterActors = [], selectedActorId, onSelectRosterActor,
  dashboardError, sceneLinkError, persistenceError, actionError, canRecoverLayout, recoverLayout, renderScenePanel, exportCapabilities, exportSnapshot,
  onInspectEmployee, executeAction, pendingTaskIds, canExecuteActions = true, hasOffice = true, editing, createEmployee, memberActors = [], memberCreationBlockReason = '' }: OfficeShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const officeOverview = useContext(OfficeOverviewPresentation)
  const renderProfile = useContext(MemberProfilePresentation)
  const [addingMember, setAddingMember] = useState(false)
  const [panel, setPanel] = useState<ScenePanel | 'profile' | ''>('')
  const [recoveryError, setRecoveryError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const detailScroll = useRef<HTMLDivElement>(null)
  const drawerTrigger = useRef<HTMLButtonElement>(null)
  const drawerWasOpen = useRef(false)
  const titleId = useId()
  const sidebarId = useId()
  const employees = dashboard?.employees ?? []
  const awaitingInitialization = !hasOffice && dataMode === 'push'
  const roster = hasOffice ? memberRoster(dashboard, rosterActors, selectedEmployeeId) : []
  const rosterSize = awaitingInitialization ? maxOfficeMembers : roster.length
  const selectedSlot = roster.find(item => item.id === selectedActorId) ?? roster.find(item => item.employee?.id === selectedEmployeeId) ?? roster[0]
  const metrics = dashboard && dashboardMetrics(dashboard)
  const currentTask = (['running', 'blocked', 'queued', 'failed'] as const)
    .map(status => dashboard?.tasks.find(task => task.status === status)).find(Boolean)
  const taskAssignee = employees.find(item => item.id === currentTask?.assigneeId)
  const completed = dashboard?.tasks.filter(task => task.status === 'completed').length
  const leadAppearanceId = roster[0] ? appearanceIds[roster[0].id] : undefined
  const addMemberBlocked = memberCreationBlockReason || (employees.length >= maxOfficeMembers ? officeMemberLimitMessage : '')
  const employee = selectedSlot?.employee
  const profile = employee ?? (selectedSlot ? { name: selectedSlot.name, role: '当前会话未分配' } : undefined)
  const overview = employee && dashboard ? memberOverview(dashboard, employee.id) : { tasks: [], events: [], currentTask: undefined, total: 0, running: 0, completed: 0 }
  const appearanceId = selectedSlot ? appearanceIds[selectedSlot.id] : undefined
  const profileDetails = employee && dashboard ? renderProfile?.({ dashboard, employeeId: employee.id, expanded: false }) : null
  const fullProfileDetails = employee && dashboard ? renderProfile?.({ dashboard, employeeId: employee.id, expanded: true }) : null
  const errors = [dashboardError, sceneLinkError, persistenceError, actionError, recoveryError].filter(Boolean)
  const runAction = (action: Parameters<OfficeShellProps['executeAction']>[0]) => { void executeAction(action).catch(() => {}) }

  useEffect(() => { if (detailScroll.current) detailScroll.current.scrollTop = 0 }, [selectedSlot?.id, employee?.id, dashboard?.conversationId])
  useEffect(() => { setAddingMember(false) }, [dashboard?.conversationId])
  useLayoutEffect(() => {
    // Restore focus after the scene's inert attribute has been removed.
    if (drawerWasOpen.current && !drawerOpen) drawerTrigger.current?.focus()
    drawerWasOpen.current = drawerOpen
  }, [drawerOpen])

  useEffect(() => {
    if (panel) dialog.current?.showModal()
    else dialog.current?.close()
  }, [panel])
  useEffect(() => {
    if (!drawerOpen) return
    const root = sidebar.current
    const focusable = () => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], select, [tabindex="0"]') ?? [])]
    focusable()[0]?.focus()
    const close = () => { setDrawerOpen(false) }
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape') close()
      if (event.key !== 'Tab') return
      const elements = focusable(), first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const media = matchMedia('(min-width: 761px)')
    const resize = () => { if (media.matches) setDrawerOpen(false) }
    document.addEventListener('keydown', keydown)
    media.addEventListener('change', resize)
    return () => { document.removeEventListener('keydown', keydown); media.removeEventListener('change', resize) }
  }, [drawerOpen])

  return <div className={`member-workspace${editing ? ' map-editing' : ''}`} data-drawer-open={drawerOpen} data-empty={!hasOffice}>
    <header className="member-brand-row" aria-label="当前办公室" inert={drawerOpen}>
      <div className="member-office-identity">{awaitingInitialization ? <QuestionAvatar height={56} /> : <CharacterAvatar appearanceId={leadAppearanceId} height={56} crop="head" />}<div>
        <span className="member-office-eyebrow">PawOffice · 当前办公室</span>
        <h1 title={dashboard?.workspace.name}>{dashboard?.workspace.name || (awaitingInitialization ? '正式办公室' : hasOffice ? '正在连接办公室…' : '尚未创建办公室')}</h1>
        <p><span>{rosterSize} 个工位</span><i aria-hidden="true" /><span title={`消息连接：${connection}`}>{dataMode === 'example' ? '本地演示' : connection}</span></p>
      </div></div>
      <div className="member-office-actions">{layoutControl}<div className="member-office-control" ref={officeSwitcherRef} /></div>
    </header>
    <section className="member-overview" aria-label="当前会话工作概况" inert={drawerOpen}>
      <article className="member-overview-card member-overview-task"><span className="member-overview-label">当前任务 <small>当前会话</small></span>
        <strong title={currentTask?.title}>{currentTask?.title ?? (completed ? '本会话任务已完成' : '暂无进行中的任务')}</strong>
        {currentTask ? <div className="member-overview-task-meta"><span>{taskAssignee?.name ?? '未分配'} · {memberTaskStatuses[currentTask.status]}</span><TaskProgress task={currentTask} /></div>
          : <small>{hasOffice ? '在下方输入框安排下一项工作' : '创建办公室后开始协作'}</small>}
      </article>
      <article className="member-overview-card"><span className="member-overview-label">进行中</span><strong>{metrics?.running ?? '—'}</strong><small>当前会话任务</small></article>
      <article className="member-overview-card"><span className="member-overview-label">已完成</span><strong>{completed ?? '—'}</strong><small>当前会话任务</small></article>
      {officeOverview ?? <article className="member-overview-card"><span className="member-overview-label">活跃成员</span><strong>{dashboard ? roster.filter(item => item.active).length : '—'}<span className="member-overview-total"> / {rosterSize}</span></strong><small>当前会话 · 绿点人数</small></article>}
    </section>
    {drawerOpen && <button className="member-drawer-backdrop" type="button" aria-label="关闭成员侧栏" onClick={() => setDrawerOpen(false)} />}
    <aside className="member-sidebar" ref={sidebar} id={sidebarId} aria-label="办公室成员" role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen || undefined}>
      {awaitingInitialization ? <OfficeMemberPlaceholders titleId={`${sidebarId}-title`} onCloseDrawer={() => setDrawerOpen(false)} /> : <>
      <section className="member-roster" aria-labelledby={`${sidebarId}-title`}><div className="member-roster-heading"><h2 id={`${sidebarId}-title`}>团队成员 <span>（{roster.length}）</span></h2><button className="member-add-button" type="button" title={addMemberBlocked || '添加成员'} aria-label="添加成员" disabled={!hasOffice || !createEmployee || !memberActors.length || !!addMemberBlocked} onClick={() => setAddingMember(true)}><Plus size={15} strokeWidth={1.8} /></button><button type="button" className="member-icon-button member-drawer-close" title="收起成员侧栏" aria-label="收起成员侧栏" onClick={() => setDrawerOpen(false)}><PanelLeftClose size={18} /></button></div>
        <div className="member-roster-grid">{roster.map(item => <button className="member-roster-person" type="button" key={item.id} data-actor-id={item.id} aria-label={`查看${item.employee?.name ?? item.name}的资料`} aria-pressed={item.id === selectedSlot?.id}
          title={item.employee?.name ?? item.name} onClick={() => { if (onSelectRosterActor) onSelectRosterActor(item.id); else if (item.employee) onSelectEmployee?.(item.employee.id) }}><span className="member-portrait"><CharacterAvatar height={46} crop="head" appearanceId={appearanceIds[item.id]} /><i className={`member-presence ${item.active ? 'online' : ''}`} role="img" aria-label={item.active ? '活跃' : '空闲'} title={item.active ? '活跃' : '空闲'} /></span><strong>{item.employee?.name ?? item.name}</strong></button>)}</div>
        {!roster.length && <p className="member-empty">暂无成员</p>}
      </section>
      <hr className="member-roster-divider" aria-hidden="true" />
      <section className="member-detail" aria-label="成员资料" aria-live="polite">
        {profile ? <>
          <div className="member-detail-summary">
          <header className="member-profile-heading"><CharacterAvatar appearanceId={appearanceId} height={52} crop="head" /><div><h2><span title={profile.name}>{profile.name}</span><i className={`member-presence ${selectedSlot?.active ? 'online' : ''}`} role="img" aria-label={selectedSlot?.active ? '活跃' : '空闲'} /></h2>
            <span className="member-profile-role" title={profile.role || '团队成员'}>{profile.role || '团队成员'}</span></div>
          </header>
          <div className="member-statistics" aria-label="当前会话任务统计"><div><strong>{overview.total}</strong><span>关联任务</span></div><div><strong>{overview.running}</strong><span>进行中</span></div><div><strong>{overview.completed}</strong><span>已完成</span></div></div>
          <span className="member-statistics-scope">当前会话</span>
          </div>
          <details className="member-tools"><summary title="办公室工具" aria-label="办公室工具"><Ellipsis size={19} /></summary><div>
              {([{ id: 'controls', label: '场景控制', icon: SlidersHorizontal }, { id: 'plugins', label: '插件', icon: Plug }, { id: 'protocol', label: '协议', icon: Braces }] as const).map(item => <button type="button" key={item.id} disabled={!hasOffice} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); setPanel(item.id) }}><item.icon size={15} />{item.label}</button>)}
              <button type="button" disabled={!hasOffice} onClick={exportCapabilities}><FileJson size={15} />导出场景协议</button><button type="button" disabled={!hasOffice} onClick={exportSnapshot}><Download size={15} />导出快照</button>
            </div></details>
          <div ref={detailScroll} className="member-detail-scroll" role="region" aria-label="当前任务与最近动态" tabIndex={0}>
          {profileDetails}
          {(overview.currentTask || !profileDetails) && <section className="member-current-task"><h3>当前任务</h3>{overview.currentTask ? <><div><strong>{overview.currentTask.title}</strong><span className={`member-task-status status-${overview.currentTask.status}`}>{memberTaskStatuses[overview.currentTask.status]}</span></div>{overview.currentTask.summary && <p className="member-task-summary">{overview.currentTask.summary}</p>}<TaskProgress task={overview.currentTask} /></> : <p className="member-empty">当前没有关联任务</p>}</section>}
          {(overview.events.length > 0 || !profileDetails) && <section className="member-recent-events"><h3>最近动态</h3><ol>{overview.events.slice(0, 3).map(event => <li key={event.id}><i /><span>{event.summary}</span><time dateTime={event.occurredAt}>{memberTime(event.occurredAt)}</time></li>)}</ol>{!overview.events.length && <p className="member-empty">暂无动态</p>}</section>}
          </div>
          <footer className="member-detail-footer"><button type="button" className="member-profile-open" disabled={!employee} title={!employee ? '当前会话未绑定业务成员' : undefined} onClick={() => { if (!employee) return; if (onInspectEmployee) onInspectEmployee(employee.id); else setPanel('profile') }}><UserRound size={16} />查看完整档案<ArrowRight size={16} /></button></footer>
        </> : <p className="member-empty">{hasOffice ? '选择一位成员查看资料' : '暂无办公室'}</p>}
      </section>
      </>}
    </aside>
    <div className="member-scene-area" inert={drawerOpen}>
      <button ref={drawerTrigger} className="member-drawer-open member-icon-button" type="button" title="展开成员侧栏" aria-label="展开成员侧栏" aria-expanded={drawerOpen} aria-controls={sidebarId} onClick={() => setDrawerOpen(true)}><PanelLeftOpen size={19} /></button>
      {!!errors.length && <div className="runtime-alert" role="alert"><span>{errors.join('；')}</span>{canRecoverLayout && <button type="button" onClick={() => { try { recoverLayout(); setRecoveryError('') } catch (cause) { setRecoveryError(String(cause)) } }}>备份并恢复布局</button>}</div>}
      {scene}
    </div>
    {addingMember && createEmployee && <AddOfficeMemberDialog key={dashboard?.conversationId} actors={memberActors} appearanceIds={appearanceIds} create={createEmployee} onClose={() => setAddingMember(false)} />}
    <dialog ref={dialog} className="member-profile-dialog" aria-labelledby={titleId} onClose={() => setPanel('')}>
      <header><h2 id={titleId}>{panel === 'profile' ? `${employee?.name ?? '成员'}的档案` : panel === 'controls' ? '场景控制' : panel === 'plugins' ? '插件' : '场景协议'}</h2><button type="button" className="member-icon-button" title="关闭" aria-label="关闭成员窗口" onClick={() => setPanel('')}><X size={19} /></button></header>
      {panel && panel !== 'profile' ? renderScenePanel(panel) : overview && <div className="member-profile-content">{actionError && <p className="member-profile-error" role="alert">{actionError}</p>}{fullProfileDetails}{(overview.total > 0 || !fullProfileDetails) && <h3>当前会话任务 <span>{overview.total}</span></h3>}
        {overview.tasks.map(task => <article className="member-profile-task" key={task.id}><div><strong>{task.title}</strong><span className={`member-task-status status-${task.status}`}>{memberTaskStatuses[task.status]}</span></div>{task.summary && <p>{task.summary}</p>}<TaskProgress task={task} />
          {canExecuteActions && <div className="member-profile-actions">{(task.status === 'queued' || task.status === 'blocked') && <button type="button" disabled={pendingTaskIds.includes(task.id)} onClick={() => runAction({ type: 'task.start', taskId: task.id })}>开始任务</button>}{(task.status === 'running' || task.status === 'blocked') && <button type="button" disabled={pendingTaskIds.includes(task.id)} onClick={() => runAction({ type: 'task.complete', taskId: task.id })}>完成任务</button>}</div>}</article>)}
        {!overview.tasks.length && !fullProfileDetails && <p className="member-empty">暂无关联任务</p>}{(overview.events.length > 0 || !fullProfileDetails) && <><h3>最近动态</h3><ol className="member-profile-events">{overview.events.map(event => <li key={event.id}><span>{event.summary}</span><time dateTime={event.occurredAt}>{memberTime(event.occurredAt)}</time></li>)}</ol>{!overview.events.length && <p className="member-empty">暂无动态</p>}</>}
      </div>}
    </dialog>
  </div>
}
