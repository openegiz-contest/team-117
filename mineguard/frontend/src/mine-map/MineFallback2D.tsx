import type { KeyboardEvent } from 'react'

import type { MineSceneModel, SceneZone } from './sceneModel'
import { RISK_COLOURS } from './sceneModel'

const WIDTH = 800
const HEIGHT = 420
const PADDING = 72

function projectedPositions(zones: SceneZone[]): Map<string, [number, number]> {
  const xs = zones.map((zone) => zone.position[0])
  const ys = zones.map((zone) => zone.position[2])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  return new Map(zones.map((zone) => [
    zone.id,
    [
      PADDING + ((zone.position[0] - minX) / spanX) * (WIDTH - PADDING * 2),
      PADDING + ((zone.position[2] - minY) / spanY) * (HEIGHT - PADDING * 2),
    ],
  ]))
}

function activateZone(event: KeyboardEvent<SVGGElement>, zoneId: string, onSelect: (zoneId: string) => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onSelect(zoneId)
}

export function MineFallback2D({ model, selected, onSelect }: { model: MineSceneModel; selected: string; onSelect: (zoneId: string) => void }) {
  const positions = projectedPositions(model.zones)
  return (
    <div className="mine-fallback-2d">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-labelledby="fallback-map-title fallback-map-description">
        <title id="fallback-map-title">MineGuard underground ventilation topology</title>
        <desc id="fallback-map-description">Keyboard-accessible schematic showing directed airways, live airflow, methane concentration, and risk for six zones.</desc>
        <defs>
          <marker id="airflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 z" fill="#55dce4" />
          </marker>
        </defs>
        {model.airways.map((airway) => {
          const source = positions.get(airway.sourceZoneId)
          const target = positions.get(airway.targetZoneId)
          if (!source || !target) return null
          const midX = (source[0] + target[0]) / 2
          const midY = (source[1] + target[1]) / 2
          return (
            <g key={airway.id} className="fallback-airway">
              <line x1={source[0]} y1={source[1]} x2={target[0]} y2={target[1]} markerEnd="url(#airflow-arrow)" />
              <text x={midX} y={midY - 8}>{airway.id} · {airway.flowM3s.toFixed(1)} m³/s</text>
            </g>
          )
        })}
        {model.zones.map((zone) => {
          const position = positions.get(zone.id)
          if (!position) return null
          const selectedZone = selected === zone.id
          return (
            <g
              key={zone.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${zone.id} ${zone.name}, ${zone.risk.replace('_', ' ')}, methane ${zone.methanePercent.toFixed(3)} percent`}
              aria-pressed={selectedZone}
              className={`fallback-zone ${selectedZone ? 'selected' : ''}`}
              transform={`translate(${position[0]} ${position[1]})`}
              onClick={() => onSelect(zone.id)}
              onKeyDown={(event) => activateZone(event, zone.id, onSelect)}
            >
              <circle r={selectedZone ? 37 : 32} style={{ stroke: RISK_COLOURS[zone.risk] }} />
              <text className="fallback-zone-id" y="-7">{zone.id}</text>
              <text className="fallback-zone-value" y="10">{zone.methanePercent.toFixed(2)}%</text>
              <text className="fallback-zone-risk" y="48">{zone.risk.replace('_', ' ')}</text>
            </g>
          )
        })}
      </svg>
      <p>2D operator view · arrows follow configured airway direction · values use the same validated live snapshot as the 3D scene</p>
    </div>
  )
}
