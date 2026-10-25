import { AlertTriangle, Fan, LocateFixed, Pause, Play, RotateCcw, ShieldAlert, Wind } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getScenarioState, scenarioCommand } from '../api/client'
import type { RiskState, ScenarioState } from '../api/contracts'
import { useMineState } from '../hooks/useMineState'
import { NetworkMap } from '../mine-map/NetworkMap'
import { buildMineScene, highestRisk, RISK_PRIORITY } from '../mine-map/sceneModel'
import { V3MineScene } from '../v3/V3MineScene'

const idleScenario: ScenarioState = { scenario_id: null, status: 'IDLE', elapsed_seconds: 0, duration_seconds: 0, simulation_only: true, applied_actions: [] }
const display = (value: number | undefined, digits = 1) => value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
const rowClass = (risk: RiskState, selected: boolean) => `${selected ? 'selected ' : ''}${risk === 'EMERGENCY' ? 'critical' : risk === 'WARNING' || risk === 'ADVISORY' ? 'elevated' : ''}`

function PanelHeading({ icon, title, aside }: { icon: React.ReactNode; title: React.ReactNode; aside?: React.ReactNode }) {
  return <div className="panel-heading"><div className="heading-wrap"><span className="heading-glyph">{icon}</span><h2>{title}</h2></div>{aside && <span className="panel-aside">{aside}</span>}</div>
}

function Meter({ label, value, max, unit, colour = 'cyan' }: { label: string; value: number; max: number; unit: string; colour?: string }) {
  return <div className="meter"><div className="meter-header"><span>{label}</span><strong className={colour}>{display(value, label === 'METHANE CH₄' ? 3 : 1)} {unit}</strong></div><div className="meter-track"><span className={colour} style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }} /></div></div>
}

export function CommandCenter() {
  const navigate = useNavigate()
  const { topology, snapshot, readiness, transport, error, updatedAt } = useMineState()
  const [selected, setSelected] = useState('Z04')
  const [scenario, setScenario] = useState<ScenarioState>(idleScenario)
  const [pending, setPending] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [airflow, setAirflow] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [showSensors, setShowSensors] = useState(true)
  const [resetSignal, setResetSignal] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [acknowledgedIncident, setAcknowledgedIncident] = useState<string | null>(null)

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => { void getScenarioState(controller.signal).then(setScenario).catch(() => undefined) }
    refresh(); const timer = window.setInterval(refresh, 2000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [])

  const stale = updatedAt === null || now - updatedAt > 6000 || readiness?.simulation_running === false
  const model = useMemo(() => topology && snapshot ? buildMineScene(topology, snapshot, stale) : null, [snapshot, stale, topology])
  const selectedZone = model?.zones.find((zone) => zone.id === selected) ?? model?.zones[0]
  const mainFan = model?.fans.find((fan) => fan.id === 'FAN_MAIN') ?? model?.fans[0]
  const systemRisk = snapshot ? (stale ? 'UNKNOWN_DATA' : highestRisk(snapshot)) : 'UNKNOWN_DATA'
  const highestZone = model?.zones.reduce((current, zone) => RISK_PRIORITY[zone.risk] > RISK_PRIORITY[current.risk] ? zone : current, model.zones[0])
  const activeScenario = scenario.status === 'RUNNING' || scenario.status === 'PAUSED'

  const command = async (path: string) => {
    setPending(true); setCommandError(null)
    try { setScenario(await scenarioCommand(path)) }
    catch (reason) { setCommandError(reason instanceof Error ? reason.message : 'Simulation command failed') }
    finally { setPending(false) }
  }

  if (!topology || !snapshot || !model || !selectedZone) return <div className="workspace"><div className="scene-placeholder"><span>◇</span><strong>CONNECTING TO VALIDATED MINEGUARD STATE</strong><p>{error ?? 'Waiting for FastAPI and Eclipse Ditto readiness…'}</p></div></div>

  const intakeFlow = snapshot.airways.find((airway) => airway.airway_id === 'E01')?.flow_m3s ?? 0
  const alertTitle = highestZone?.risk === 'EMERGENCY' ? 'Emergency simulation response active' : highestZone?.risk === 'WARNING' ? 'Hazard threshold warning' : highestZone?.risk === 'ADVISORY' ? 'Elevated methane advisory' : highestZone?.risk === 'UNKNOWN_DATA' ? 'Telemetry uncertainty' : 'No configured constraint exceeded'
  const alertText = highestZone ? `${highestZone.id} · ${highestZone.name}: ${highestZone.methanePercent.toFixed(3)}% CH₄, ${highestZone.coPpm.toFixed(1)} ppm CO, ${highestZone.airflowM3s.toFixed(1)} m³/s airflow.` : 'No zone state available.'
  const safetyIncident = stale ? undefined : snapshot.safety.find((item) => item.evacuation_advisory || item.production_stop)
  const incidentKey = safetyIncident ? `${scenario.scenario_id ?? 'BASELINE'}:${safetyIncident.zone_id}:${safetyIncident.risk_state}` : null

  return <>
    {(error || commandError) && <div role="alert" className="error-banner"><strong>LIVE SYSTEM ERROR</strong><span>{error ?? commandError}</span></div>}
    <div className="workspace has-rails v3-command-workspace">
      <aside className="left-rail rail">
        <section className="panel fan-panel"><PanelHeading icon={<Fan size={19} />} title={<>MAIN<br />VENTILATION</>} aside={<span className="tiny-badge">FAN<br />MAIN</span>} />
          <div className="kpi-pair"><div className="kpi"><div>FAN SPEED</div><strong>{Math.round(mainFan?.actualRpm ?? 0).toLocaleString()}</strong><small>RPM</small></div><div className="kpi"><div>INTAKE FLOW</div><strong>{display(intakeFlow, 1)}</strong><small>m³/s</small></div></div>
          <div className="vent-heading"><span>ACTUAL SPEED</span><strong>{Math.round((mainFan?.speedFraction ?? 0) * 100)}%</strong></div>
          <input type="range" min="0" max="100" value={Math.round((mainFan?.speedFraction ?? 0) * 100)} readOnly aria-label="Actual simulated fan speed" />
          {model.production && <div className={`vent-heading machine-state ${model.production.running ? 'running' : 'tripped'}`}><span>{model.production.zoneId} CUTTING MACHINE</span><strong>{model.production.running ? `RUNNING · ${Math.round(model.production.powerKw)} kW` : 'TRIPPED (SIMULATED)'}</strong></div>}
          <button type="button" className="emergency-button" disabled={pending || activeScenario} onClick={() => void command('S1_METHANE_LEAK/start')}><AlertTriangle size={15} /> SIMULATE<br />METHANE OUTBURST</button>
        </section>
        <section className="panel telemetry-panel"><PanelHeading icon={<Wind size={19} />} title={<>SECTOR<br />TELEMETRY</>} aside={<span className="stream-state">LIVE<br />READINGS</span>} />
          <div className="zone-list">{model.zones.map((zone) => <button type="button" key={zone.id} onClick={() => setSelected(zone.id)} className={`zone-row ${rowClass(zone.risk, selected === zone.id)}`}><div className="zone-name"><b>{zone.id} — {zone.name}</b><small>{zone.quality} · SYNTHETIC PHYSICS</small></div><div className="zone-reading"><strong>{zone.methanePercent.toFixed(3)}%</strong><span>CH₄</span><small>{zone.risk.replace('_', ' ')}</small></div></button>)}</div>
          <div className="rail-note">{snapshot.publication_status === 'ECLIPSE_DITTO_READBACK' ? 'ECLIPSE DITTO READBACK' : 'LOCAL MODEL'} · {transport} · T+{snapshot.simulated_seconds.toFixed(1)}s · TICK {snapshot.tick}</div>
        </section>
      </aside>

      <section className="main-view v3-main-view">
        <div className="scene-tools"><button type="button" onClick={() => setAirflow((value) => !value)}><Wind size={13} /> Airflow: <b className={airflow ? 'online-text' : ''}>{airflow ? 'ON' : 'OFF'}</b></button><i /><button type="button" onClick={() => setResetSignal((value) => value + 1)}><LocateFixed size={13} /> Recenter View</button><i /><button type="button" onClick={() => setWireframe((value) => !value)}>◇ Wireframe: <b className={wireframe ? 'online-text' : ''}>{wireframe ? 'ON' : 'OFF'}</b></button><i /><button type="button" onClick={() => setShowSensors((value) => !value)}>Sensors: <b className={showSensors ? 'online-text' : ''}>{showSensors ? 'ON' : 'OFF'}</b></button></div>
        <V3MineScene model={model} selected={selectedZone.id} onSelect={setSelected} airflow={airflow} wireframe={wireframe} resetSignal={resetSignal} showSensors={showSensors} />
        <div className="selected-sector-pop"><div>SELECTED SECTOR <span>{selectedZone.id}</span></div><b>{selectedZone.name}</b><p>CH₄ <strong>{selectedZone.methanePercent.toFixed(3)}%</strong><span className={selectedZone.risk.toLowerCase()}>{selectedZone.risk.replace('_', ' ')}</span></p><small>FLOW: {selectedZone.airflowM3s.toFixed(1)} m³/s · QUALITY: {selectedZone.quality}</small></div>
        <NetworkMap topology={topology} model={model} selected={selectedZone.id} onSelect={setSelected} />
        <div className="sim-tray"><span className="tray-label">SIMULATION CONTROL</span>{activeScenario ? <button disabled={pending} onClick={() => void command('reset')}><RotateCcw size={12} /> Reset</button> : <button disabled={pending} onClick={() => void command('S1_METHANE_LEAK/start')}><Play size={12} /> Gas Release</button>}<button disabled={pending || scenario.status === 'IDLE'} onClick={() => void command(scenario.status === 'PAUSED' ? 'resume' : 'pause')}>{scenario.status === 'PAUSED' ? <Play size={12} /> : <Pause size={12} />} {scenario.status === 'PAUSED' ? 'Resume' : 'Pause'}</button><button disabled={pending || activeScenario} onClick={() => void command('S2_MAIN_FAN_FAILURE/start')}><Fan size={12} /> Fan Failure</button><button disabled={pending || activeScenario} onClick={() => void command('S3_AIRWAY_OBSTRUCTION/start')}><Wind size={12} /> Airway Block</button><button disabled={pending || activeScenario} onClick={() => void command('S4_SENSOR_LOSS/start')}><AlertTriangle size={12} /> Sensor Loss</button></div>
      </section>

      <aside className="right-rail rail">
        <section className="panel advisory-panel"><PanelHeading icon={<ShieldAlert size={19} />} title={<>RISK ENGINE<br />ADVISORY</>} aside={<span className="tiny-badge">FSM<br />LIVE</span>} />
          <div className={`advisory-box ${systemRisk === 'EMERGENCY' ? 'critical' : ''}`}><strong><AlertTriangle size={17} /> {alertTitle}</strong><p>{alertText}</p><small>{highestZone?.reasons.join(' · ') || 'VALIDATED LIVE STATE'}</small></div>
          <button type="button" className="optimize-button" onClick={() => navigate('/energy')}>OPEN VOD DECISION TRACE</button>
        </section>
        <section className="panel atmos-panel"><PanelHeading icon={<Wind size={19} />} title={<>SELECTED SECTOR<br />STATUS</>} />
          <Meter label="METHANE CH₄" value={selectedZone.methanePercent} max={2} unit="% vol" colour={selectedZone.risk === 'EMERGENCY' ? 'amber' : 'cyan'} />
          <Meter label="CO CARBON MONOXIDE" value={selectedZone.coPpm} max={50} unit="ppm" />
          <Meter label="AIRFLOW" value={selectedZone.airflowM3s} max={45} unit="m³/s" />
          <div className="detail-grid compact-sector"><div className="detail"><small>DEPTH</small><strong>{selectedZone.depthM.toFixed(0)} m</strong></div><div className="detail"><small>QUALITY</small><strong>{selectedZone.quality}</strong></div></div>
        </section>
      </aside>
    </div>
    {safetyIncident && incidentKey && acknowledgedIncident !== incidentKey && <div className="incident-backdrop"><section className="incident-modal" role="alertdialog" aria-modal="true"><ShieldAlert size={34} /><p className="eyebrow">SIMULATION-ONLY SAFETY INTERLOCK</p><h2>Power isolation and evacuation response</h2><p>Sector {safetyIncident.zone_id} entered {safetyIncident.risk_state}. All displayed actions are simulated and cannot control physical equipment.</p><div className="incident-buttons"><button onClick={() => { setSelected(safetyIncident.zone_id); setAcknowledgedIncident(incidentKey) }}>Inspect sector</button><button className="secondary" onClick={() => setAcknowledgedIncident(incidentKey)}>Acknowledge simulation</button></div></section></div>}
  </>
}
