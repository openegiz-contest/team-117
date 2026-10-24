import type { ComponentType } from 'react'

interface EvidenceDashboardProps {
  data: unknown
  mode: 'live'
  setMode: (mode: string) => void
  error: string | null
  onNavigate: (view: 'twin' | 'command' | 'scenario' | 'energy' | 'evidence') => void
}

declare const EvidenceDashboard: ComponentType<EvidenceDashboardProps>
export default EvidenceDashboard
