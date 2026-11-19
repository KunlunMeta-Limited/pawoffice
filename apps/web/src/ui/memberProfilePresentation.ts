import { createContext } from 'react'
import type { ReactNode } from 'react'
import type { DashboardSnapshot } from '@pawoffice/protocol/dashboard'

export type MemberProfileProps = { dashboard: DashboardSnapshot; employeeId: string; expanded: boolean }
export const MemberProfilePresentation = createContext<((props: MemberProfileProps) => ReactNode) | null>(null)
