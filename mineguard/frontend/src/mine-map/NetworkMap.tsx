import type { Topology } from '../api/contracts'
import { RISK_COLOURS, type MineSceneModel } from './sceneModel'

const NODE_RADIUS = 30
const MAX_FLOW = 45

/**
 * Plan view of the real ventilation graph (topology coordinates), drawn only
 * from the Ditto-readback scene model: zone risk and CH4, per-airway flow and
 * obstruction, fan RPM and faults. Cheap to render on CPU-only browsers.
 */
export function NetworkMap({ topology, model, selected, onSelect }: {
  topology: Topology
  model: MineSceneModel
  selected: string
  onSelect: (id: string) => void
}) {
  const coordinates = new Map(topology.zones.map((zone) => [zone.id, { x: zone.x, y: zone.y }]))
  const zones = new Map(model.zones.map((zone) => [zone.id, zone]))
  const fanZone = new Map(topology.fans.map((fan) => [fan.id, fan.zone_id]))

  return <figure className="network-map" aria-label="Ventilation network plan view from Eclipse Ditto readback">
    <figcaption><b>VENTILATION NETWORK</b><span>plan view · Ditto readback · m³/s</span></figcaption>
    <svg viewBox="0 20 800 340" role="img" aria-label="Directed airway graph with live airflow">
      <defs>
        <marker id="network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="currentColor" /></marker>
      </defs>
      {model.airways.map((airway) => {
        const from = coordinates.get(airway.sourceZoneId)
        const to = coordinates.get(airway.targetZoneId)
        if (!from || !to) return null
        const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
        const ux = (to.x - from.x) / length
        const uy = (to.y - from.y) / length
        const x1 = from.x + ux * NODE_RADIUS
        const y1 = from.y + uy * NODE_RADIUS
        const x2 = to.x - ux * (NODE_RADIUS + 4)
        const y2 = to.y - uy * (NODE_RADIUS + 4)
        const restricted = airway.resistanceFactor > 1
        const still = airway.flowM3s < 0.05
        const state = still ? 'still' : restricted ? 'restricted' : 'open'
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2 + (uy === 0 ? -12 : 0)
        return <g key={airway.id} className={`network-airway ${state}`} data-airway={airway.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={2 + Math.min(1, airway.flowM3s / MAX_FLOW) * 9} markerEnd="url(#network-arrow)" />
          <text x={midX} y={midY} textAnchor="middle">{airway.id} {airway.flowM3s.toFixed(1)}{restricted ? ` ×${airway.resistanceFactor.toFixed(0)}` : ''}</text>
        </g>
      })}
      {topology.zones.map((zone) => {
        const live = zones.get(zone.id)
        const risk = live?.risk ?? 'UNKNOWN_DATA'
        return <g key={zone.id} className={`network-zone ${selected === zone.id ? 'selected' : ''}`} data-zone={zone.id} transform={`translate(${zone.x} ${zone.y})`} onClick={() => onSelect(zone.id)} role="button" tabIndex={0} aria-label={`${zone.id} ${zone.name}: ${risk}`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(zone.id) }}>
          <circle r={NODE_RADIUS} style={{ stroke: RISK_COLOURS[risk] }} />
          <text y={-4} textAnchor="middle" className="zone-code">{zone.id}</text>
          <text y={13} textAnchor="middle" className="zone-gas">{live ? `${live.methanePercent.toFixed(2)}%` : '—'}</text>
        </g>
      })}
      {model.production && (() => {
        const home = coordinates.get(model.production.zoneId)
        if (!home) return null
        const running = model.production.running
        return <g className={`network-machine ${running ? 'running' : 'tripped'}`} data-machine={model.production.id} transform={`translate(${home.x} ${home.y + NODE_RADIUS + 24})`}>
          <rect x={-9} y={-9} width={18} height={18} rx={3} />
          <text x={16} y={5}>CUTTING {running ? `ON ${Math.round(model.production.powerKw)} kW` : 'TRIPPED'}</text>
        </g>
      })()}
      {model.fans.map((fan) => {
        const home = coordinates.get(fanZone.get(fan.id) ?? '')
        if (!home) return null
        const below = fan.id === 'FAN_MAIN'
        const y = home.y + (below ? NODE_RADIUS + 26 : -NODE_RADIUS - 22)
        return <g key={fan.id} className={`network-fan ${fan.faulted ? 'faulted' : ''}`} data-fan={fan.id} transform={`translate(${home.x} ${y})`}>
          <circle r={11} />
          <text x={16} y={4}>{fan.id === 'FAN_MAIN' ? 'MAIN' : 'AUX'} {fan.faulted ? 'FAULT' : `${Math.round(fan.actualRpm)} rpm`}</text>
        </g>
      })}
    </svg>
  </figure>
}
