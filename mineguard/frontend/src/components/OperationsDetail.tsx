import { ArrowDownToLine, Fan, ShieldAlert, Wind } from 'lucide-react'
import type { Readiness, Snapshot, Topology } from '../api/contracts'
import { observedTransitions } from '../api/telemetryAnalysis'
import { StatusBadge } from './StatusBadge'

export function OperationsDetail({ snapshot, history, selected, topology, stale, readiness }: {
  snapshot: Snapshot; history: Snapshot[]; selected: string; topology: Topology; stale: boolean; readiness: Readiness | null
}) {
  const decision = snapshot.safety.find((item) => item.zone_id === selected)
  const transitions = observedTransitions(history, selected).slice(-6).reverse()
  const exportEvidence = () => {
    const evidence = { captured_at: new Date().toISOString(), simulation_only: true, source_type: snapshot.source_type,
      selected_zone: selected, platform_readiness: readiness, retained_readings_stale: stale,
      snapshot, topology, observed_transitions: observedTransitions(history, selected), history }
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `mineguard-${selected}-tick-${snapshot.tick}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="operations-detail">
    <div className="panel response-panel">
      <div className="section-title"><h2><ShieldAlert size={17} /> {selected} · Response verification</h2><span>Simulated only</span></div>
      <div className="response-chain">
        <article><small>01 / OBSERVATION</small><StatusBadge value={stale ? 'UNKNOWN_DATA' : decision?.risk_state ?? 'UNKNOWN_DATA'} /><p>{stale ? 'Feed stale; retained response is not current confirmation.' : decision?.reason_codes.join(' · ') ?? 'Awaiting decision'}</p></article>
        <article><small>02 / PROTECTION</small><strong>{stale || !decision ? 'Unverified' : decision.production_stop ? 'Power isolation requested' : 'No isolation requested'}</strong><p>{!stale && decision ? decision.evacuation_advisory ? 'Simulated evacuation advisory active' : 'No evacuation advisory' : 'Live safety state unavailable'}</p></article>
        <article><small>03 / VENTILATION</small><strong>{stale || !decision ? 'Unverified' : decision.ventilation_response ? 'Emergency ventilation requested' : 'Baseline ventilation'}</strong><p>{!stale && decision ? decision.optimization_enabled ? 'Optimization permitted by safety gate' : 'Energy optimization inhibited' : 'Feedback must be revalidated'}</p></article>
      </div>
      <div className="connected-airways"><h3>Connected ventilation paths</h3><div>{topology.airways.filter((edge) => edge.from === selected || edge.to === selected).map((edge) => {
        const flow = snapshot.airways.find((item) => item.airway_id === edge.id)?.flow_m3s
        return <article key={edge.id}><span>{edge.id} · {edge.to === selected ? 'INCOMING' : 'OUTGOING'}</span><strong>{edge.from} → {edge.to}</strong><small>{flow === undefined ? 'Unverified airflow' : `${flow.toFixed(2)} m³/s`}{stale ? ' · retained' : ''}</small></article>
      })}</div></div>
      <div className="fan-feedback" aria-label="Fan command and feedback">
        {snapshot.fans.map((fan) => {
          const request = decision?.fan_requests.find((item) => item.fan_id === fan.fan_id)
          return <article key={fan.fan_id}><Fan size={20} /><div><strong>{fan.fan_id.replaceAll('_', ' ')}</strong><small>{stale ? 'Retained feedback' : fan.faulted ? 'FAULTED' : 'Measured simulation feedback'}</small></div><dl><div><dt>Actual speed</dt><dd>{Math.round(fan.actual_speed_fraction * 100)}% · {fan.actual_speed_rpm.toFixed(0)} rpm</dd></div><div><dt>Power</dt><dd>{fan.power_kw.toFixed(1)} kW</dd></div><div><dt>Safety request</dt><dd>{request ? `${Math.round(request.requested_speed_fraction * 100)}% / ${stale ? 'UNVERIFIED' : request.status}` : 'No selected-zone request'}</dd></div></dl>{request && <code>Command {request.command_id}</code>}</article>
        })}
      </div>
      <div className="readback-line"><Wind size={15} /><span>Ditto readback: <strong>{readiness?.platform_connected ? `verified through tick ${readiness.platform_last_verified_tick ?? 'unknown'}` : 'not currently verified'}</strong> · displayed physics tick {snapshot.tick}</span></div>
    </div>
    <div className="panel transition-panel"><div className="section-title"><h2>Observed risk transitions</h2><button onClick={exportEvidence} className="evidence-export"><ArrowDownToLine size={14} /> Export evidence</button></div><p className="quiet">Rolling received history · sample times, not inferred event times.</p>{transitions.length ? <ol>{transitions.map((event) => <li key={event.tick}><time>T+{event.seconds.toFixed(1)}s</time><div><StatusBadge value={event.to} /><p>{event.from} → {event.to}</p><small>{event.reasons.join(' · ')}</small></div></li>)}</ol> : <div className="empty-state">No risk transition in the received window.</div>}</div>
  </section>
}
