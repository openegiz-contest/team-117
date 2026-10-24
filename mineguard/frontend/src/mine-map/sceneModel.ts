import type { RiskState, Snapshot, Topology } from '../api/contracts'

export type Vector3Tuple = [number, number, number]

export interface SceneZone {
  id: string
  name: string
  role: string
  depthM: number
  position: Vector3Tuple
  methanePercent: number
  coPpm: number
  airflowM3s: number
  risk: RiskState
  quality: string
  reasons: string[]
  isolated: boolean
}

export interface SceneAirway {
  id: string
  sourceZoneId: string
  targetZoneId: string
  source: Vector3Tuple
  target: Vector3Tuple
  flowM3s: number
}

export interface SceneFan {
  id: string
  position: Vector3Tuple
  speedFraction: number
  actualRpm: number
  powerKw: number
  faulted: boolean
}

export interface MineSceneModel {
  zones: SceneZone[]
  airways: SceneAirway[]
  fans: SceneFan[]
}

export const RISK_COLOURS: Record<RiskState, string> = {
  NORMAL: '#22d3c5',
  ADVISORY: '#f5d451',
  WARNING: '#ff9f43',
  EMERGENCY: '#ff4545',
  UNKNOWN_DATA: '#b794f6',
}

export const RISK_PRIORITY: Record<RiskState, number> = {
  NORMAL: 0,
  ADVISORY: 1,
  WARNING: 2,
  UNKNOWN_DATA: 3,
  EMERGENCY: 4,
}

export function highestRisk(snapshot: Snapshot): RiskState {
  return snapshot.risks.reduce<RiskState>(
    (current, item) => RISK_PRIORITY[item.state] > RISK_PRIORITY[current] ? item.state : current,
    'NORMAL',
  )
}

export function buildMineScene(topology: Topology, snapshot: Snapshot, stale = false): MineSceneModel {
  const xs = topology.zones.map((zone) => zone.x)
  const ys = topology.zones.map((zone) => zone.y)
  const depths = topology.zones.map((zone) => zone.depth_m)
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2
  const shallowest = Math.min(...depths)
  const riskByZone = new Map(snapshot.risks.map((item) => [item.zone_id, item]))
  const gasByZone = new Map(snapshot.zones.map((item) => [item.zone_id, item]))

  const zones = topology.zones.map<SceneZone>((zone) => {
    const risk = riskByZone.get(zone.id)
    return {
      id: zone.id,
      name: zone.name,
      role: zone.role,
      depthM: zone.depth_m,
      position: [
        (zone.x - centreX) / 25,
        -(zone.depth_m - shallowest) / 90,
        (zone.y - centreY) / 23,
      ],
      methanePercent: (risk?.methane_fraction ?? gasByZone.get(zone.id)?.methane_fraction ?? 0) * 100,
      coPpm: risk?.co_ppm ?? gasByZone.get(zone.id)?.co_ppm ?? 0,
      airflowM3s: risk?.airflow_m3s ?? 0,
      risk: stale ? 'UNKNOWN_DATA' : risk?.state ?? 'UNKNOWN_DATA',
      quality: stale ? 'STALE' : risk?.quality ?? 'STALE',
      reasons: stale ? ['LIVE_FEED_STALE', ...(risk?.reason_codes ?? [])] : risk?.reason_codes ?? ['STATE_UNAVAILABLE'],
      isolated: snapshot.safety.find((item) => item.zone_id === zone.id)?.production_stop ?? false,
    }
  })
  const positions = new Map(zones.map((zone) => [zone.id, zone.position]))
  const liveFlows = new Map(snapshot.airways.map((item) => [item.airway_id, item.flow_m3s]))

  const airways = topology.airways.flatMap<SceneAirway>((airway) => {
    const source = positions.get(airway.from)
    const target = positions.get(airway.to)
    if (!source || !target) return []
    return [{
      id: airway.id,
      sourceZoneId: airway.from,
      targetZoneId: airway.to,
      source,
      target,
      flowM3s: liveFlows.get(airway.id) ?? airway.flow_m3s,
    }]
  })
  const fanConfig = new Map(topology.fans.map((fan) => [fan.id, fan]))
  const fans = snapshot.fans.flatMap<SceneFan>((fan) => {
    const config = fanConfig.get(fan.fan_id)
    const zonePosition = config ? positions.get(config.zone_id) : undefined
    if (!zonePosition) return []
    return [{
      id: fan.fan_id,
      position: [zonePosition[0], zonePosition[1] + 0.65, zonePosition[2]],
      speedFraction: fan.actual_speed_fraction,
      actualRpm: fan.actual_speed_rpm,
      powerKw: fan.power_kw,
      faulted: fan.faulted,
    }]
  })
  return { zones, airways, fans }
}
