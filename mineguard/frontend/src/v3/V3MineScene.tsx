import { useEffect, useMemo, useRef, useState } from 'react'

import type { MineSceneModel } from '../mine-map/sceneModel'
import { MineEngine } from './MineEngine.js'
import type { V3SceneState } from './MineEngine.js'
import { toV3SceneState } from './sceneAdapter'

const HUD: Record<string, [number, number]> = {
  Z06: [0.025, 0.28],
  Z05: [0.045, 0.51],
  Z01: [0.24, 0.64],
  Z03: [0.47, 0.34],
  Z02: [0.78, 0.52],
  Z04: [0.68, 0.16],
}
const ORDER = ['Z06', 'Z05', 'Z01', 'Z03', 'Z02', 'Z04']

function labelRisk(methanePercent: number, risk: string): string {
  if (risk === 'UNKNOWN_DATA') return 'UNKNOWN DATA'
  if (risk === 'EMERGENCY') return 'EMERGENCY'
  if (risk === 'WARNING') return 'WARNING'
  if (risk === 'ADVISORY' || methanePercent >= 0.3) return 'ELEVATED'
  return 'NORMAL'
}

export function V3MineScene({ model, selected, onSelect, airflow, wireframe, resetSignal, showSensors }: {
  model: MineSceneModel
  selected: string
  onSelect: (id: string) => void
  airflow: boolean
  wireframe: boolean
  resetSignal: number
  showSensors: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const engine = useRef<MineEngine | null>(null)
  const latest = useRef({ onSelect })
  const [error, setError] = useState('')
  const data = useMemo<V3SceneState>(() => toV3SceneState(model), [model])
  const initialState = useRef({ data, selected, airflow, wireframe })
  useEffect(() => { latest.current = { onSelect } }, [onSelect])

  useEffect(() => {
    const node = root.current
    if (!node) return undefined
    let scene: MineEngine | undefined
    let disposed = false
    try {
      scene = new MineEngine(node, (positions) => {
        const element = root.current
        if (!element) return
        const width = element.clientWidth
        const height = element.clientHeight
        for (const [id, position] of Object.entries(positions)) {
          const label = element.querySelector<HTMLElement>(`[data-v3-sector="${id}"]`)
          const link = element.querySelector<SVGLineElement>(`[data-v3-link="${id}"]`)
          const dot = element.querySelector<SVGCircleElement>(`[data-v3-end="${id}"]`)
          if (!label || !link || !dot || !HUD[id]) continue
          const [fx, fy] = HUD[id]
          const left = Math.max(8, Math.min(width - label.offsetWidth - 9, width * fx))
          const top = Math.max(70, Math.min(height - label.offsetHeight - 70, height * fy))
          label.style.left = `${left}px`
          label.style.top = `${top}px`
          const cx = left + label.offsetWidth * 0.5
          const cy = top + label.offsetHeight * 0.5
          const px = Math.max(-100, Math.min(width + 100, position.x))
          const py = Math.max(-100, Math.min(height + 100, position.y))
          link.setAttribute('x1', String(cx)); link.setAttribute('y1', String(cy))
          link.setAttribute('x2', String(px)); link.setAttribute('y2', String(py))
          dot.setAttribute('cx', String(px)); dot.setAttribute('cy', String(py))
          const visible = position.visible && position.x >= 0 && position.x < width && position.y >= 0 && position.y < height
          link.style.opacity = visible ? '.55' : '0'; dot.style.opacity = visible ? '1' : '0'
        }
      }, (id) => latest.current.onSelect(id))
      engine.current = scene
      const initial = initialState.current
      scene.setState(initial.data, initial.selected, initial.airflow, initial.wireframe)
    } catch (reason) {
      const message = `WebGL initialization failed: ${reason instanceof Error ? reason.message : 'unknown error'}`
      queueMicrotask(() => { if (!disposed) setError(message) })
    }
    return () => { disposed = true; scene?.destroy(); engine.current = null }
  }, [])
  useEffect(() => engine.current?.setState(data, selected, airflow, wireframe), [airflow, data, selected, wireframe])
  useEffect(() => { if (resetSignal > 0) engine.current?.recenter() }, [resetSignal])

  return <div className="scene-root scene-root-v2 scene-root-v3" ref={root} aria-label="Interactive V3 underground mine ventilation model">
    {error && <div className="scene-error" role="alert">{error}<p>Enable browser WebGL hardware acceleration.</p></div>}
    <div className="scene-vignette" aria-hidden="true" />
    <svg className="scene-connectors" aria-hidden="true">{ORDER.map((id) => <g key={id}><line data-v3-link={id} x1="0" y1="0" x2="0" y2="0" /><circle data-v3-end={id} cx="0" cy="0" r="3.4" /></g>)}</svg>
    {showSensors && ORDER.map((id) => {
      const zone = model.zones.find((item) => item.id === id)
      if (!zone) return null
      const risk = labelRisk(zone.methanePercent, zone.risk)
      return <button type="button" data-v3-sector={id} key={id} onClick={() => onSelect(id)} className={`floating-label ${selected === id ? 'selected' : ''} ${zone.risk === 'EMERGENCY' ? 'danger' : ''}`}>
        <span className="floating-code">{zone.id} — {zone.role.toUpperCase()}</span>
        <strong>{zone.methanePercent.toFixed(3)}% CH₄</strong>
        <em>{risk}</em>
      </button>
    })}
    <div className="scene-caption">SIX-ZONE DIGITAL TWIN <b>·</b> SYNTHETIC PHYSICS <b>·</b> LIVE READBACK</div>
    <div className="scene-compass" aria-hidden="true"><span>N</span><span>◇</span><span>S</span></div>
  </div>
}
