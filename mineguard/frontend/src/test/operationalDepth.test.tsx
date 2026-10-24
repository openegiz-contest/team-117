import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { RiskState, Snapshot } from '../api/contracts'
import { observedTransitions } from '../api/telemetryAnalysis'
import { parseDecisionTrace, type DecisionTrace } from '../api/decisionContract'
import { DecisionExplorer } from '../components/DecisionExplorer'
import { OperationsDetail } from '../components/OperationsDetail'

afterEach(cleanup)
const frame = (tick: number, state: RiskState): Snapshot => ({
  tick, simulated_seconds: tick / 2, paused: false, simulation_only: true, source_type: 'SYNTHETIC_PHYSICS',
  zones: [], airways: [], fans: [], safety: [],
  risks: [{ zone_id: 'Z04', state, quality: 'GOOD', methane_fraction: 0.016, co_ppm: 2, airflow_m3s: 20, reason_codes: [state] }],
})
const trace: DecisionTrace = {
  simulation_only: true, simulated_seconds: 10,
  constraints: { warning_methane_fraction: 0.01, warning_co_fraction: 0.000035, minimum_airflow_m3s: 5, forecast_horizon_seconds: 60 },
  vod_decision: { status: 'NO_FEASIBLE_SAFE_OPTIMIZATION', command_status: 'NOT_ISSUED', selected: null, comparison: null, reason_codes: ['CONSTRAINTS_FAILED'],
    candidates: [{ fan_speeds: [{ fan_id: 'FAN_MAIN', speed_fraction: 0.4 }], feasible: false, reason_codes: ['FAN_FAILED'], forecast_max_methane_fraction: null, forecast_max_co_ppm: null, forecast_min_airflow_m3s: null, fan_energy_kwh: null, switching_penalty_kwh: null, objective_kwh: null }] },
}
it('records sampled transitions without fabricating crossing times or carrying them across reset', () => {
  const history = [frame(0, 'NORMAL'), frame(2, 'ADVISORY'), frame(4, 'WARNING'), frame(6, 'EMERGENCY')]
  expect(observedTransitions(history, 'Z04').map((e) => [e.seconds, e.to])).toEqual([[1, 'ADVISORY'], [2, 'WARNING'], [3, 'EMERGENCY']])
  expect(observedTransitions([...history, frame(0, 'NORMAL')], 'Z04')).toEqual([])
  expect(observedTransitions(history, 'MISSING')).toEqual([])
})
it('accepts null forecasts for rejected candidates and rejects invalid numerical readings', () => {
  expect(parseDecisionTrace(trace).vod_decision.selected).toBeNull()
  const bad = structuredClone(trace)
  bad.vod_decision.candidates[0].forecast_max_co_ppm = NaN
  expect(() => parseDecisionTrace(bad)).toThrow('Invalid decision')
  expect(() => parseDecisionTrace({})).toThrow()
})
it('exposes infeasibility and null values rather than rendering zeros or suggested savings', () => {
  render(<DecisionExplorer trace={trace} />)
  expect(screen.getByText('REJECTED')).toBeTruthy()
  expect(screen.getByText('FAN_FAILED')).toBeTruthy()
  expect(screen.getAllByText(/unavailable/).length).toBeGreaterThan(0)
  fireEvent.change(screen.getByLabelText('Filter ventilation candidates'), { target: { value: 'feasible' } })
  expect(screen.getByText(/No candidates in this category/)).toBeTruthy()
})
it('marks stale safety decisions as unverified even if their retained state was normal', () => {
  render(<OperationsDetail snapshot={frame(2, 'NORMAL')} history={[]} selected="Z04" stale readiness={null}
    topology={{ mine_id: 'mineguard:mine-01', simulation_only: true, zones: [], fans: [], airways: [] }} />)
  expect(screen.getByText('UNKNOWN DATA')).toBeTruthy()
  expect(screen.getAllByText('Unverified')).toHaveLength(2)
  expect(screen.getByText('not currently verified')).toBeTruthy()
})
