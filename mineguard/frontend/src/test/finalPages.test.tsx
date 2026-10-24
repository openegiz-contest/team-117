import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EvidenceDashboard from '../pages/EvidenceDashboard.jsx'
import FinalThreePages from '../pages/FinalThreePages.jsx'

const trace = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../api/client', () => ({ getDecisionTrace: () => Promise.resolve(trace.value) }))

afterEach(() => cleanup())

const noop = () => Promise.resolve()
const pageProps = { setView: () => undefined, data: null, error: null, pending: false, startScenario: noop, pause: noop, reset: noop }
const constraints = { warning_methane_fraction: 0.01, warning_co_fraction: 0.000035, minimum_airflow_m3s: 5, forecast_horizon_seconds: 60 }

describe('energy page reports the controller decision, not a fixed label', () => {
  it('shows a safety-blocked decision as NOT_ISSUED with no comparison', async () => {
    trace.value = { simulation_only: true, simulated_seconds: 42, constraints, vod_decision: { status: 'DISABLED_BY_SAFETY', command_status: 'NOT_ISSUED', reason_codes: ['SAFETY_STATE_BLOCKS_OPTIMIZATION'], selected: null, candidates: [], comparison: null } }
    render(<FinalThreePages view="energy" {...pageProps} />)
    await waitFor(() => expect(screen.getByText('NOT_ISSUED')).toBeTruthy())
    expect(screen.getByText(/Optimization is disabled by the current safety state/)).toBeTruthy()
    expect(screen.getAllByText('Not evaluated')).toHaveLength(2)
  })

  it('marks the selected feasible candidate and keeps rejected ones rejected', async () => {
    const candidate = (main: number, feasible: boolean) => ({ fan_speeds: [{ fan_id: 'FAN_AUX', speed_fraction: 0.4 }, { fan_id: 'FAN_MAIN', speed_fraction: main }], feasible, reason_codes: [feasible ? 'FORECAST_CONSTRAINTS_MET' : 'FORECAST_AIRFLOW_CONSTRAINT'], forecast_max_methane_fraction: 0.002, forecast_max_co_ppm: 9, forecast_min_airflow_m3s: 12, fan_energy_kwh: 0.6, switching_penalty_kwh: 0.01, objective_kwh: 0.61 })
    const selected = candidate(0.6, true)
    trace.value = { simulation_only: true, simulated_seconds: 42, constraints, vod_decision: { status: 'SELECTED', command_status: 'PROPOSED', reason_codes: ['LOWEST_FEASIBLE_ENERGY'], selected, candidates: [selected, candidate(0.4, false)], comparison: { horizon_seconds: 60, baseline_energy_kwh: 1.17, optimized_energy_kwh: 0.6, absolute_savings_kwh: 0.57, savings_percent: 48.7, baseline_constraints_met: true, optimized_constraints_met: true } } }
    render(<FinalThreePages view="energy" {...pageProps} />)
    await waitFor(() => expect(screen.getByText('PROPOSED')).toBeTruthy())
    expect(screen.getByText('SELECTED')).toBeTruthy()
    expect(screen.getByText('REJECTED')).toBeTruthy()
    expect(screen.getByText('1/2 feasible')).toBeTruthy()
    expect(screen.getByText('48.7%')).toBeTruthy()
  })
})

describe('evidence page shows backend runtime checks', () => {
  it('passes only when the backend reports every check', () => {
    const validation = { status: 'PARTIAL', unit_checks: 'PASS', scenario_repeatability: 'PASS', telemetry_freshness: 'FAIL', residual_bounds: 'PASS', source_traceability: 'NOT_VERIFIED', details: { telemetry_freshness: 'Platform state: DITTO_READBACK_STALE' } }
    render(<EvidenceDashboard data={{ source: 'ECLIPSE DITTO READBACK', tick: 7, evidence: { validation } }} error={null} onNavigate={() => undefined} />)
    expect(screen.getByText('PARTIAL')).toBeTruthy()
    expect(screen.getAllByText('● PASS')).toHaveLength(3)
    expect(screen.getByText('· FAIL')).toBeTruthy()
    expect(screen.getByText('Platform state: DITTO_READBACK_STALE')).toBeTruthy()
  })
})
