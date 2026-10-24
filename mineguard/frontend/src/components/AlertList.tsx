import type { Snapshot } from '../api/contracts'
import { StatusBadge } from './StatusBadge'

export function AlertList({ snapshot, stale = false }: { snapshot: Snapshot; stale?: boolean }) {
  const alerts = snapshot.risks.filter((risk) => risk.state !== 'NORMAL')
  return (
    <section className="panel alerts" aria-labelledby="alerts-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Decision support</p>
          <h2 id="alerts-title">Active conditions</h2>
        </div>
        <span className="count">{alerts.length}</span>
      </div>
      {stale ? (
        <div className="stale-condition" role="alert">
          <StatusBadge value="UNKNOWN_DATA" />
          <p>Live telemetry is stale. Previous readings remain visible for diagnosis and are not classified as safe.</p>
        </div>
      ) : alerts.length === 0 ? (
        <p className="quiet">No model constraints are currently exceeded.</p>
      ) : (
        <ul>
          {alerts.map((risk) => (
            <li key={risk.zone_id}>
              <div><strong>{risk.zone_id}</strong><StatusBadge value={risk.state} /></div>
              <p>{risk.reason_codes.join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
