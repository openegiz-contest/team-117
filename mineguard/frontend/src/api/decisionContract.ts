export interface Candidate {
  fan_speeds: { fan_id: string; speed_fraction: number }[]
  feasible: boolean
  reason_codes: string[]
  forecast_max_methane_fraction: number | null
  forecast_max_co_ppm: number | null
  forecast_min_airflow_m3s: number | null
  fan_energy_kwh: number | null
  switching_penalty_kwh: number | null
  objective_kwh: number | null
}
export interface Comparison {
  baseline_energy_kwh: number; optimized_energy_kwh: number; absolute_savings_kwh: number
  savings_percent: number | null; baseline_constraints_met: boolean; optimized_constraints_met: boolean; horizon_seconds: number
}
export interface DecisionTrace {
  simulation_only: true
  simulated_seconds: number
  constraints: { warning_methane_fraction: number; warning_co_fraction: number; minimum_airflow_m3s: number; forecast_horizon_seconds: number }
  vod_decision: { status: string; command_status: string; reason_codes: string[]; selected: Candidate | null; candidates: Candidate[]; comparison: Comparison | null }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonnegative = (v: unknown) => finite(v) && v >= 0
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((item) => typeof item === 'string')
export function isCandidate(v: unknown): v is Candidate {
  return record(v) && typeof v.feasible === 'boolean' && strings(v.reason_codes) &&
    Array.isArray(v.fan_speeds) && v.fan_speeds.every((f) => record(f) && typeof f.fan_id === 'string' && finite(f.speed_fraction) && f.speed_fraction >= 0 && f.speed_fraction <= 1) &&
    ['forecast_max_methane_fraction', 'forecast_max_co_ppm', 'forecast_min_airflow_m3s', 'fan_energy_kwh', 'switching_penalty_kwh', 'objective_kwh'].every((key) => v[key] === null || nonnegative(v[key]))
}
export function parseDecisionTrace(v: unknown): DecisionTrace {
  if (!record(v) || v.simulation_only !== true || !nonnegative(v.simulated_seconds) || !record(v.constraints) || !record(v.vod_decision)) throw new Error('Invalid decision trace')
  const d = v.vod_decision
  if (!['warning_methane_fraction', 'warning_co_fraction', 'minimum_airflow_m3s', 'forecast_horizon_seconds'].every((key) => nonnegative((v.constraints as Record<string, unknown>)[key])) ||
    typeof d.status !== 'string' || typeof d.command_status !== 'string' || !strings(d.reason_codes) ||
    !Array.isArray(d.candidates) || !d.candidates.every(isCandidate) || (d.selected !== null && !isCandidate(d.selected))) throw new Error('Invalid decision candidates or constraints')
  const c = d.comparison
  if (c !== null && (!record(c) || !['baseline_energy_kwh', 'optimized_energy_kwh', 'absolute_savings_kwh', 'horizon_seconds'].every((key) => finite(c[key])) ||
    !(c.savings_percent === null || finite(c.savings_percent)) || typeof c.baseline_constraints_met !== 'boolean' || typeof c.optimized_constraints_met !== 'boolean')) throw new Error('Invalid energy comparison')
  return v as unknown as DecisionTrace
}
