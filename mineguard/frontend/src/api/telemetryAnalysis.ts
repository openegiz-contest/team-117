import type { RiskState, Snapshot } from './contracts'

export interface ObservedTransition {
  tick: number
  seconds: number
  from: RiskState
  to: RiskState
  reasons: string[]
}

/** Transitions are observations in received samples. A reset starts a new run. */
export function observedTransitions(history: Snapshot[], zoneId: string): ObservedTransition[] {
  let result: ObservedTransition[] = []
  let previous: Snapshot['risks'][number] | undefined
  let lastTick = -1
  for (const frame of history) {
    if (frame.tick < lastTick) { result = []; previous = undefined }
    if (frame.tick === lastTick) continue
    const current = frame.risks.find((risk) => risk.zone_id === zoneId)
    if (current && previous && current.state !== previous.state) {
      result.push({ tick: frame.tick, seconds: frame.simulated_seconds, from: previous.state, to: current.state, reasons: current.reason_codes })
    }
    previous = current
    lastTick = frame.tick
  }
  return result
}
