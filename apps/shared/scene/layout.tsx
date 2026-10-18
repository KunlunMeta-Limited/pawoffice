import type { ReactNode } from 'react'
import './scene-only.css'

export type LayoutMode = 'full' | 'scene'
export type SceneSlot = (overlay?: ReactNode) => ReactNode

export function SceneOnlyLayout({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`pawoffice-scene-only ${className}`}>{children}</main>
}
