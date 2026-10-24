import type { ScenarioState } from '../api/contracts'

export function SimulationControls({ state, pending, onCommand }: { state: ScenarioState; pending: boolean; onCommand: (command: 'pause' | 'resume' | 'reset') => void }) {
  return <div className="controls">
    {state.status === 'RUNNING' && <button disabled={pending} onClick={() => onCommand('pause')}>Pause</button>}
    {state.status === 'PAUSED' && <button disabled={pending} onClick={() => onCommand('resume')}>Resume</button>}
    <button className="secondary" disabled={pending || state.status === 'IDLE'} onClick={() => onCommand('reset')}>Reset baseline</button>
  </div>
}
