import { Box, Expand, LocateFixed, Map as MapIcon, MousePointer2, Rotate3d, Wind } from 'lucide-react'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'

import type { Snapshot, Topology } from '../api/contracts'
import { MineFallback2D } from './MineFallback2D'
import { buildMineScene, highestRisk, RISK_COLOURS } from './sceneModel'
import { canRenderWebGL } from './webgl'
import type { CameraPreset, SceneLayers } from './MineScene3D'

const MineScene3D = lazy(() => import('./MineScene3D'))

interface MineMapProps {
  topology: Topology
  snapshot: Snapshot
  selected: string
  onSelect: (zoneId: string) => void
  stale: boolean
  platformConfigured: boolean
  platformConnected: boolean
}

export function MineMap({
  topology,
  snapshot,
  selected,
  onSelect,
  stale,
  platformConfigured,
  platformConnected,
}: MineMapProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const webgl = useMemo(() => canRenderWebGL(), [])
  const [mode, setMode] = useState<'3d' | '2d'>(() => webgl ? '3d' : '2d')
  const [resetSignal, setResetSignal] = useState(0)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('overview')
  const [layers, setLayers] = useState<SceneLayers>({ airflow: true, gas: true, sensors: true, structure: true })
  const model = useMemo(() => buildMineScene(topology, snapshot, stale), [snapshot, stale, topology])
  const selectedZone = model.zones.find((zone) => zone.id === selected) ?? model.zones[0]
  const systemRisk = stale ? 'UNKNOWN_DATA' : highestRisk(snapshot)

  const fullscreen = async () => {
    if (!viewport.current?.requestFullscreen) return
    await viewport.current.requestFullscreen()
  }

  const sourceLabel = stale
    ? 'LIVE DATA STALE · DISPLAY HELD'
    : platformConnected
      ? 'DITTO-LINKED MODEL'
      : platformConfigured
        ? 'DITTO SYNC DEGRADED · LOCAL PHYSICS'
        : 'LOCAL PHYSICS MODEL'

  return (
    <div className={`twin-viewport twin-risk-${systemRisk.toLowerCase()}`} ref={viewport}>
      {mode === '3d' && <div className="scene-control-bar" aria-label="3D scene controls">
        <span className="scene-edition-badge">Industrial cutaway <b>V3</b></span>
        <div className="camera-presets">
          {(['overview', 'top', 'airflow', 'focus'] as const).map((preset) => <button type="button" key={preset} className={cameraPreset === preset ? 'active' : ''} onClick={() => setCameraPreset(preset)}>{preset}</button>)}
        </div>
        <div className="scene-layers"><span>Layers</span>{(Object.keys(layers) as (keyof SceneLayers)[]).map((layer) => <label key={layer}><input type="checkbox" checked={layers[layer]} onChange={() => setLayers((current) => ({ ...current, [layer]: !current[layer] }))} /><i />{layer}</label>)}</div>
      </div>}
      <div className="twin-toolbar">
        <div><Rotate3d size={15} /><span>Live spatial twin</span></div>
        <div className="twin-toolbar-actions">
          <button
            type="button"
            className={mode === '3d' ? 'active' : ''}
            title={webgl ? 'Show interactive 3D view' : 'WebGL is unavailable'}
            aria-label="Show interactive 3D view"
            aria-pressed={mode === '3d'}
            disabled={!webgl}
            onClick={() => setMode('3d')}
          ><Box size={15} /></button>
          <button
            type="button"
            className={mode === '2d' ? 'active' : ''}
            title="Show accessible 2D topology"
            aria-label="Show accessible 2D topology"
            aria-pressed={mode === '2d'}
            onClick={() => setMode('2d')}
          ><MapIcon size={15} /></button>
          {mode === '3d' && <button type="button" title="Reset 3D camera" aria-label="Reset 3D camera" onClick={() => setResetSignal((value) => value + 1)}><LocateFixed size={15} /></button>}
          <button type="button" title="Enter fullscreen" aria-label="Enter fullscreen" onClick={() => void fullscreen()}><Expand size={15} /></button>
        </div>
      </div>
      <div className={`twin-canvas ${mode === '2d' ? 'is-hidden' : ''}`} role="region" aria-hidden={mode === '2d'} aria-label="Interactive 3D digital twin of the MineGuard six-zone underground mine">
        {webgl ? (
          <Suspense fallback={<div className="webgl-fallback"><span className="spinner" /><strong>Loading spatial twin…</strong></div>}>
            <MineScene3D model={model} selected={selected} onSelect={onSelect} resetSignal={resetSignal} preset={cameraPreset} layers={layers} />
          </Suspense>
        ) : null}
      </div>
      {mode === '2d' && <div className="twin-canvas is-2d" role="region" aria-label="Accessible 2D topology of the MineGuard six-zone underground mine"><MineFallback2D model={model} selected={selected} onSelect={onSelect} /></div>}
      <div className={`twin-live-chip ${!platformConnected || stale ? 'degraded' : ''}`}><span className="live-dot" />{sourceLabel} · T+{snapshot.simulated_seconds.toFixed(1)}s</div>
      {mode === '3d' && <div className="twin-guide"><MousePointer2 size={13} /> Drag to orbit · Scroll to zoom · Select any zone</div>}
      <div className="risk-legend" aria-label="Risk-state legend">
        {(['NORMAL', 'ADVISORY', 'WARNING', 'EMERGENCY', 'UNKNOWN_DATA'] as const).map((risk) => <span key={risk}><i style={{ background: RISK_COLOURS[risk] }} />{risk.replace('_', ' ')}</span>)}
      </div>
      {selectedZone && <aside className="zone-inspector" aria-live="polite">
        <div className="zone-inspector-heading"><span style={{ background: RISK_COLOURS[selectedZone.risk] }} /><div><small>SELECTED SECTOR</small><strong>{selectedZone.id} · {selectedZone.name}</strong></div></div>
        <dl>
          <div><dt>Methane</dt><dd>{selectedZone.methanePercent.toFixed(3)} <small>% vol</small></dd></div>
          <div><dt>Carbon monoxide</dt><dd>{selectedZone.coPpm.toFixed(1)} <small>ppm</small></dd></div>
          <div><dt>Airflow</dt><dd>{selectedZone.airflowM3s.toFixed(1)} <small>m³/s</small></dd></div>
          <div><dt>Depth</dt><dd>{selectedZone.depthM.toFixed(0)} <small>m</small></dd></div>
          <div><dt>Quality</dt><dd>{selectedZone.quality}</dd></div>
        </dl>
        <p><Wind size={13} /> {selectedZone.reasons.join(' · ')}</p>
      </aside>}
      <div className="zone-selector" aria-label="Mine zones">
        {model.zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            aria-label={`Select ${zone.id} ${zone.name}`}
            aria-pressed={selected === zone.id}
            className={`zone-${zone.risk.toLowerCase()} ${selected === zone.id ? 'selected' : ''}`}
            onClick={() => onSelect(zone.id)}
          >
            <i style={{ background: RISK_COLOURS[zone.risk] }} /><span>{zone.id}</span><small>{zone.methanePercent.toFixed(2)}%</small>
          </button>
        ))}
      </div>
    </div>
  )
}
