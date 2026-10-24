import type { ComponentType } from 'react'

interface EvidenceDashboardProps {
  data: unknown
  error: string | null
  onNavigate: (view: 'twin' | 'command' | 'scenario' | 'energy' | 'evidence') => void
}

declare const EvidenceDashboard: ComponentType<EvidenceDashboardProps>
export default EvidenceDashboard
