import type { DecisionTrace } from '../api/decisionContract'
import type { Readiness, ScenarioState, Snapshot, Topology } from '../api/contracts'

export interface PatchedDashboardData {
  simulated: true
  source: string
  updatedAt: string | null
  tick: number
  status: ScenarioState['status']
  scenario: string | null
  scenario_elapsed_seconds: number
  zones: Array<{
    id: string
    name: string
    ch4: number
    co: number
    oxygen: null
    airflow: number
    quality: string
    source: string
    updatedAt: string | null
  }>
  fan: { id: string; rpm: number; flow: number; override: number; healthy: boolean }
  fans: Array<{ id: string; rpm: number; flow: number; override: number; healthy: boolean }>
  atmosphere: { co: number; pressure: null; oxygen: null; temperature: null }
  energy: { baseline: number | null; optimized: number | null; savedPercent: number | null; unit: string }
  events: Array<{ type: string; description: string; at: null }>
  decisionTrace: Array<{
    observation: string
    reason_code: string
    decision: string
    outcome: string
    timestamp: null
  }>
  twinReadbacks: Record<string, unknown>
}

const riskRank: Record<string, number> = {
  NORMAL: 0,
  ADVISORY: 1,
  WARNING: 2,
  EMERGENCY: 3,
  UNKNOWN_DATA: 4,
}

export function toPatchedDashboardData(
  topology: Topology,
  snapshot: Snapshot,
  scenario: ScenarioState,
  decision: DecisionTrace | null,
  readiness: Readiness | null,
  updatedAt: number | null,
  twinReadbacks: Record<string, unknown> = {},
): PatchedDashboardData {
  const stamp = updatedAt === null ? null : new Date(updatedAt).toISOString()
  const risks = new Map(snapshot.risks.map((item) => [item.zone_id, item]))
  const mainFan = snapshot.fans.find((fan) => fan.fan_id === 'FAN_MAIN') ?? snapshot.fans[0]
  const intake = topology.zones.find((zone) => zone.role === 'intake')
  const intakeFlow = intake ? risks.get(intake.id)?.airflow_m3s ?? 0 : 0
  const comparison = decision?.vod_decision.comparison
  const worst = [...snapshot.risks].sort((left, right) => (riskRank[right.state] ?? -1) - (riskRank[left.state] ?? -1))[0]
  const safety = snapshot.safety.find((item) => item.zone_id === worst?.zone_id)
  const reasons = [...(worst?.reason_codes ?? []), ...(safety?.reason_codes ?? []), ...(decision?.vod_decision.reason_codes ?? [])]
  const fanFeedback = safety?.fan_requests.map((item) => `${item.fan_id} ${item.status} ${(item.actual_speed_fraction * 100).toFixed(0)}%`).join('; ')
  const decisionLabel = safety?.production_stop
    ? `SIMULATED production stop ${safety.production_stop ? 'ON' : 'OFF'}; evacuation ${safety.evacuation_advisory ? 'ON' : 'OFF'}`
    : decision
      ? `VOD ${decision.vod_decision.status}; command ${decision.vod_decision.command_status}`
      : 'Decision trace unavailable'

  return {
    simulated: true,
    source: snapshot.publication_status === 'ECLIPSE_DITTO_READBACK'
      ? readiness?.platform_connected === false ? 'ECLIPSE DITTO READBACK (STALE)' : 'ECLIPSE DITTO READBACK'
      : 'LOCAL MODEL · PLATFORM NOT CONFIGURED',
    updatedAt: stamp,
    tick: snapshot.tick,
    status: scenario.status,
    scenario: scenario.scenario_id,
    scenario_elapsed_seconds: scenario.elapsed_seconds,
    zones: topology.zones.map((zone) => {
      const risk = risks.get(zone.id)
      return {
        id: zone.id,
        name: zone.name,
        ch4: (risk?.methane_fraction ?? 0) * 100,
        co: risk?.co_ppm ?? 0,
        oxygen: null,
        airflow: risk?.airflow_m3s ?? 0,
        quality: risk?.quality ?? 'INVALID',
        source: snapshot.source_type,
        updatedAt: stamp,
      }
    }),
    fan: {
      id: mainFan?.fan_id ?? 'UNAVAILABLE',
      rpm: mainFan?.actual_speed_rpm ?? 0,
      flow: intakeFlow,
      override: (mainFan?.actual_speed_fraction ?? 0) * 100,
      healthy: !(mainFan?.faulted ?? true),
    },
    fans: snapshot.fans.map((fan) => ({
      id: fan.fan_id,
      rpm: fan.actual_speed_rpm,
      flow: fan.fan_id === 'FAN_MAIN' ? intakeFlow : 0,
      override: fan.actual_speed_fraction * 100,
      healthy: !fan.faulted,
    })),
    atmosphere: {
      co: Math.max(0, ...snapshot.risks.map((item) => item.co_ppm)),
      pressure: null,
      oxygen: null,
      temperature: null,
    },
    energy: {
      baseline: comparison?.baseline_energy_kwh ?? null,
      optimized: comparison?.optimized_energy_kwh ?? null,
      savedPercent: comparison?.savings_percent ?? null,
      unit: comparison ? `${comparison.horizon_seconds}s identical forecast horizon` : 'Decision comparison unavailable',
    },
    events: scenario.applied_actions.map((action) => ({ type: 'SCENARIO_ACTION', description: action, at: null })),
    decisionTrace: [{
      observation: worst
        ? `${worst.zone_id} ${worst.state}; CH4 ${(worst.methane_fraction * 100).toFixed(3)}% vol; CO ${worst.co_ppm.toFixed(1)} ppm; airflow ${worst.airflow_m3s.toFixed(1)} m3/s`
        : 'No validated risk assessment available',
      reason_code: reasons.length ? [...new Set(reasons)].join(', ') : 'NO_ACTIVE_REASON_CODE',
      decision: decisionLabel,
      outcome: fanFeedback || 'No fan-response feedback in the current safety decision',
      timestamp: null,
    }],
    twinReadbacks,
  }
}
