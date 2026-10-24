import type { Quality, RiskState } from '../api/contracts'

export function StatusBadge({ value }: { value: RiskState | Quality | 'CONNECTED' | 'DISCONNECTED' }) {
  return <span className={`status status-${value.toLowerCase()}`}>{value.replace('_', ' ')}</span>
}
