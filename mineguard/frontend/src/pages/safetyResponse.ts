import type { Snapshot } from '../api/contracts'
import { RISK_PRIORITY } from '../mine-map/sceneModel'

type SafetyDecision = Snapshot['safety'][number]

export type FanResponseStatus = 'FAULTED' | 'PENDING' | 'ACHIEVED' | 'AT SETPOINT'
export type VentilationResponse = 'NONE' | 'PROPOSED' | 'COMMANDED'

export interface FanResponse {
  fanId: string
  label: string
  requestedPercent: number
  actualPercent: number
  rpm: number
  powerKw: number
  status: FanResponseStatus
}

export interface SafetyResponseSummary {
  productionStopZones: string[]
  productionRunning: boolean
  evacuationZones: string[]
  ventilation: VentilationResponse
  ventilationZones: string[]
  fans: FanResponse[]
}

// Ditto carries speeds as % rounded to 6 decimals; anything closer than 0.01 % is at the request.
const SPEED_TOLERANCE = 1e-4

const zonesWhere = (snapshot: Snapshot, flag: (decision: SafetyDecision) => boolean) =>
  snapshot.safety.filter(flag).map((decision) => decision.zone_id).sort()

/**
 * What the simulated safety response is doing right now, from the Ditto readback only.
 * Requested speed is the drive command (`fans[].requested_speed_fraction`), so a fan
 * reads PENDING while it ramps and ACHIEVED once an emergency request is met.
 * Advisory and warning fan requests are proposals: the model applies only emergency ones.
 */
export function summarizeSafetyResponse(snapshot: Snapshot): SafetyResponseSummary {
  const emergencyRequests = new Set(
    snapshot.safety
      .filter((decision) => decision.risk_state === 'EMERGENCY' && decision.ventilation_response)
      .flatMap((decision) => decision.fan_requests.map((request) => request.fan_id)),
  )
  const ventilationZones = zonesWhere(snapshot, (decision) => decision.ventilation_response)
  const fans = [...snapshot.fans]
    .sort((a, b) => Number(b.fan_id === 'FAN_MAIN') - Number(a.fan_id === 'FAN_MAIN') || a.fan_id.localeCompare(b.fan_id))
    .map((fan): FanResponse => {
      const requested = fan.requested_speed_fraction ?? fan.actual_speed_fraction
      const atRequest = Math.abs(requested - fan.actual_speed_fraction) < SPEED_TOLERANCE
      const status: FanResponseStatus = fan.faulted ? 'FAULTED' : !atRequest ? 'PENDING' : emergencyRequests.has(fan.fan_id) ? 'ACHIEVED' : 'AT SETPOINT'
      return {
        fanId: fan.fan_id,
        label: fan.fan_id.replace(/^FAN_/, ''),
        requestedPercent: requested * 100,
        actualPercent: fan.actual_speed_fraction * 100,
        rpm: fan.actual_speed_rpm,
        powerKw: fan.power_kw,
        status,
      }
    })
  return {
    productionStopZones: zonesWhere(snapshot, (decision) => decision.production_stop),
    productionRunning: snapshot.production?.running ?? true,
    evacuationZones: zonesWhere(snapshot, (decision) => decision.evacuation_advisory),
    ventilation: emergencyRequests.size > 0 ? 'COMMANDED' : ventilationZones.length > 0 ? 'PROPOSED' : 'NONE',
    ventilationZones,
    fans,
  }
}

/** The most severe zone whose simulated interlock stopped production or advised evacuation. */
export function activeSafetyIncident(snapshot: Snapshot): SafetyDecision | undefined {
  return snapshot.safety
    .filter((decision) => decision.production_stop || decision.evacuation_advisory)
    .reduce<SafetyDecision | undefined>((worst, decision) => !worst || RISK_PRIORITY[decision.risk_state] > RISK_PRIORITY[worst.risk_state] ? decision : worst, undefined)
}

/** Popup copy built from the incident's own flags, so it names only the actions that are active. */
export function describeSafetyIncident(decision: SafetyDecision): { title: string; actions: string[] } {
  const actions: string[] = []
  if (decision.production_stop) actions.push(`Production stop: power to ${decision.zone_id} equipment isolated (simulated)`)
  if (decision.evacuation_advisory) actions.push(`Evacuation advisory for ${decision.zone_id} (simulated)`)
  if (decision.ventilation_response) {
    actions.push(decision.risk_state === 'EMERGENCY'
      ? 'Healthy fans commanded to 100 % at the 5 %/s drive ramp (simulated)'
      : 'Stronger ventilation proposed; not applied automatically below EMERGENCY')
  }
  if (decision.reason_codes.includes('FAILED_FAN_EXCLUDED')) actions.push('Failed fan excluded from the response')
  if (decision.risk_state === 'UNKNOWN_DATA') actions.push(`${decision.zone_id} telemetry is stale and is treated as unsafe`)
  return {
    title: decision.evacuation_advisory ? 'Power isolation and evacuation advisory' : 'Production stop (power isolation)',
    actions,
  }
}
