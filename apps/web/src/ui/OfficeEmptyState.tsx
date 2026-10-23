import { useEffect, useId, useRef, useState } from 'react'
import { BriefcaseBusiness, LaptopMinimal, Plus, UserRoundPlus, X } from 'lucide-react'
import { OfficeCreationForm } from './team-switcher/OfficeCreationForm.tsx'
import type { OfficeCreationInput } from '../dashboard/officeDirectory.ts'
import './team-switcher/TeamOverview.css'
import './OfficeEmptyState.css'

export function OfficeEmptyState({ create, message = '暂无办公室' }: { create?: (input: OfficeCreationInput) => Promise<void>; message?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const element = dialog.current
    element?.showModal()
    element?.querySelector('input')?.focus()
    return () => element?.close()
  }, [open])
  const close = () => { if (!busy) { setOpen(false); trigger.current?.focus() } }

  return <main className="office-main office-main-empty" aria-label="办公室空状态">
    <section className="office-welcome" aria-labelledby={`${id}-title`}>
      <img className="office-welcome-art" src={`${import.meta.env.BASE_URL}assets/office/empty-office.webp`} alt="等待布置办公室的同事与小猫" width={1280} height={720} />
      <h1 id={`${id}-title`}>还没有办公室</h1>
      <p className="office-welcome-description">创建你的第一个办公室，开启 AI 团队协作之旅</p>
      <ul className="office-welcome-features" aria-label="办公室功能">
        <li><LaptopMinimal size={23} strokeWidth={1.7} /><div><strong>自定义办公环境</strong><span>多种风格，随心搭配</span></div></li>
        <li><UserRoundPlus size={23} strokeWidth={1.7} /><div><strong>添加 AI 员工</strong><span>组建你的专属团队</span></div></li>
        <li><BriefcaseBusiness size={23} strokeWidth={1.7} /><div><strong>管理任务与项目</strong><span>让工作井井有条</span></div></li>
      </ul>
      {create ? <button ref={trigger} type="button" className="office-create-empty" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Plus size={21} strokeWidth={1.8} /><span>新建办公室</span>
      </button> : <p className="office-welcome-status" role="status">{message}</p>}
    </section>
    {open && create && <dialog ref={dialog} className="team-picker office-creation-dialog" aria-labelledby={id}
      onCancel={event => { event.preventDefault(); close() }}>
      <header className="team-picker-header"><h2 id={id}>创建办公室</h2><button type="button" className="team-picker-close" title="关闭" aria-label="关闭创建办公室" disabled={busy} onClick={close}><X size={19} /></button></header>
      <OfficeCreationForm create={create} onCancel={close} onCreated={() => setOpen(false)} onBusyChange={setBusy} />
    </dialog>}
  </main>
}
