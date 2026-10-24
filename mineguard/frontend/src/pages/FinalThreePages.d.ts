import type { ComponentType } from 'react'

interface FinalThreePagesProps {
  view: 'twin' | 'scenario' | 'energy'
  setView: (view: 'twin' | 'command' | 'scenario' | 'energy' | 'evidence') => void
  mode: 'live'
  setMode: (mode: string) => void
  data: unknown
  error: string | null
  pending: boolean
  startScenario: (id: string) => Promise<unknown>
  pause: () => Promise<unknown>
  reset: () => Promise<unknown>
}

declare const FinalThreePages: ComponentType<FinalThreePagesProps>
export default FinalThreePages
