import { useState } from 'react'
import type { DecisionTrace } from '../api/decisionContract'

export function DecisionExplorer({ trace }: { trace: DecisionTrace }) {
  const [filter, setFilter] = useState('all')
  const { candidates, selected, command_status, reason_codes } = trace.vod_decision
  const shown = candidates.filter((c) => filter === 'all' || (filter === 'feasible' ? c.feasible : !c.feasible))
  const chosen = selected?.fan_speeds.map((f) => `${f.fan_id}:${f.speed_fraction}`).join('|')
  return <section className="panel decision-explorer">
    <div className="section-title"><div><p className="eyebrow">Why this ventilation setting?</p><h2>Candidate decision explorer</h2></div><label>Show <select aria-label="Filter ventilation candidates" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All candidates ({candidates.length})</option><option value="feasible">Feasible</option><option value="rejected">Rejected</option></select></label></div>
    <div className="decision-facts"><span>Sample T+{trace.simulated_seconds.toFixed(1)}s</span><span>{trace.constraints.forecast_horizon_seconds}s forecast</span><span>Command: {command_status}</span><span>{candidates.filter((c) => c.feasible).length}/{candidates.length} feasible</span></div>
    <p className="quiet">{reason_codes.join(' · ')}. A proposed setting is a model recommendation; actual safety command feedback is shown in the Command Center.</p>
    <p className="constraint-caption">Demonstration constraints: CH₄ &lt; {(trace.constraints.warning_methane_fraction * 100).toFixed(2)}% vol · CO &lt; {(trace.constraints.warning_co_fraction * 1e6).toFixed(0)} ppm · airflow ≥ {trace.constraints.minimum_airflow_m3s} m³/s</p>
    <div className="candidate-table"><table><thead><tr><th>Fan settings</th><th>CH₄ max</th><th>CO max</th><th>Airflow min</th><th>Energy</th><th>Switch cost</th><th>Decision</th></tr></thead><tbody>{shown.map((c, index) => {
      const isSelected = chosen === c.fan_speeds.map((f) => `${f.fan_id}:${f.speed_fraction}`).join('|')
      return <tr key={index} className={isSelected ? 'chosen-candidate' : ''}><td>{c.fan_speeds.map((f) => <span key={f.fan_id}>{f.fan_id.replace('FAN_', '')} {Math.round(f.speed_fraction * 100)}% </span>)}</td><td>{(c.forecast_max_methane_fraction === null ? 'unavailable' : (c.forecast_max_methane_fraction * 100).toFixed(3))}%</td><td>{c.forecast_max_co_ppm?.toFixed(1) ?? 'unavailable'} ppm</td><td>{c.forecast_min_airflow_m3s?.toFixed(1) ?? 'unavailable'} m³/s</td><td>{c.fan_energy_kwh?.toFixed(3) ?? 'unavailable'} kWh</td><td>{c.switching_penalty_kwh?.toFixed(3) ?? 'unavailable'} kWh</td><td><strong>{isSelected ? 'SELECTED' : c.feasible ? 'FEASIBLE' : 'REJECTED'}</strong><small>{c.reason_codes.join(' · ')}</small></td></tr>
    })}</tbody></table>{!shown.length && <p className="quiet">No candidates in this category. {reason_codes.join(' · ')}</p>}</div>
  </section>
}
