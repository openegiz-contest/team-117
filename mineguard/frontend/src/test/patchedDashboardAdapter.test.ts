import { describe, expect, it } from 'vitest'

import type { DecisionTrace } from '../api/decisionContract'
import type { Readiness, ScenarioState, Snapshot, Topology } from '../api/contracts'
import { toPatchedDashboardData } from '../pages/patchedDashboardAdapter'

const topology: Topology = {
  simulation_only: true,
  mine_id: 'mineguard:mine-01',
  zones: [
    { id: 'Z01', name: 'Intake', role: 'intake', volume_m3: 100, depth_m: 100, x: 0, y: 0 },
    { id: 'Z04', name: 'Face', role: 'production', volume_m3: 100, depth_m: 450, x: 1, y: 1 },
  ],
  airways: [{ id: 'E01', from: 'Z01', to: 'Z04', flow_m3s: 12 }],
  fans: [{ id: 'FAN_MAIN', zone_id: 'Z01', rated_speed_rpm: 1200 }],
}

const snapshot: Snapshot = {
  tick: 42,
  simulated_seconds: 21,
  paused: false,
  simulation_only: true,
  source_type: 'SYNTHETIC_PHYSICS',
  zones: [{ zone_id: 'Z01', methane_fraction: 0.001, co_ppm: 3 }, { zone_id: 'Z04', methane_fraction: 0.016, co_ppm: 12 }],
  airways: [{ airway_id: 'E01', flow_m3s: 12 }],
  fans: [{ fan_id: 'FAN_MAIN', actual_speed_fraction: 1, actual_speed_rpm: 1200, faulted: false, power_kw: 100 }],
  risks: [
    { zone_id: 'Z01', state: 'NORMAL', reason_codes: ['WITHIN_LIMITS'], quality: 'GOOD', methane_fraction: 0.001, co_ppm: 3, airflow_m3s: 12 },
    { zone_id: 'Z04', state: 'EMERGENCY', reason_codes: ['METHANE_EMERGENCY'], quality: 'GOOD', methane_fraction: 0.016, co_ppm: 12, airflow_m3s: 8 },
  ],
  safety: [{ zone_id: 'Z04', risk_state: 'EMERGENCY', production_stop: true, evacuation_advisory: true, ventilation_response: true, optimization_enabled: false, simulation_only: true, reason_codes: ['LOCKOUT_REQUIRED'], fan_requests: [{ fan_id: 'FAN_MAIN', command_id: 'cmd-1', requested_speed_fraction: 1, actual_speed_fraction: 1, status: 'ACHIEVED' }] }],
}

const scenario: ScenarioState = { scenario_id: 'S1_METHANE_LEAK', status: 'RUNNING', elapsed_seconds: 21, duration_seconds: 180, simulation_only: true, applied_actions: ['Z04_SOURCE_RAISED'] }
const decision = {
  simulation_only: true,
  simulated_seconds: 21,
  constraints: { warning_methane_fraction: 0.01, warning_co_fraction: 0.000035, minimum_airflow_m3s: 5, forecast_horizon_seconds: 60 },
  vod_decision: { status: 'BLOCKED_BY_SAFETY', command_status: 'NOT_APPLIED', reason_codes: ['EMERGENCY_ACTIVE'], selected: null, candidates: [], comparison: null },
} satisfies DecisionTrace
const readiness: Readiness = { status: 'ready', simulation_running: true, simulation_error: '', platform_configured: true, platform_connected: true, platform_last_verified_tick: 42, platform_error: '', source_type: 'SYNTHETIC_PHYSICS' }

describe('exact-patch live adapter', () => {
  it('maps validated percent-volume, CO, airflow, fan and scenario values without demo IDs', () => {
    const data = toPatchedDashboardData(topology, snapshot, scenario, decision, readiness, 1_000)
    expect(data.zones.find((zone) => zone.id === 'Z04')).toMatchObject({ ch4: 1.6, co: 12, airflow: 8, quality: 'GOOD' })
    expect(data.fan).toMatchObject({ id: 'FAN_MAIN', rpm: 1200, override: 100, healthy: true })
    expect(data.scenario).toBe('S1_METHANE_LEAK')
    expect(data.source).toContain('ECLIPSE DITTO')
    expect(data.twinReadbacks).toEqual({})
  })

  it('derives the evidence trail from current validated decisions and labels actions simulated', () => {
    const data = toPatchedDashboardData(topology, snapshot, scenario, decision, readiness, 1_000)
    expect(data.decisionTrace[0].observation).toContain('Z04 EMERGENCY')
    expect(data.decisionTrace[0].reason_code).toContain('LOCKOUT_REQUIRED')
    expect(data.decisionTrace[0].decision).toContain('SIMULATED production stop ON')
    expect(data.decisionTrace[0].outcome).toContain('FAN_MAIN ACHIEVED 100%')
  })
})
