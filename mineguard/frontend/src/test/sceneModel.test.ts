import { describe, expect, it } from 'vitest'

import type { Snapshot, Topology } from '../api/contracts'
import { buildMineScene, highestRisk } from '../mine-map/sceneModel'

const topology = {
  simulation_only: true,
  mine_id: 'mineguard:mine-01',
  zones: [
    { id: 'Z01', name: 'Intake', role: 'intake', volume_m3: 100, depth_m: 100, x: 0, y: 0 },
    { id: 'Z04', name: 'Face', role: 'production', volume_m3: 100, depth_m: 450, x: 100, y: 50 },
  ],
  airways: [{ id: 'E01', from: 'Z01', to: 'Z04', flow_m3s: 20 }],
  fans: [{ id: 'FAN_MAIN', zone_id: 'Z04', rated_speed_rpm: 1200 }],
} satisfies Topology

const snapshot = {
  tick: 12,
  simulated_seconds: 6,
  paused: false,
  simulation_only: true,
  source_type: 'SYNTHETIC_PHYSICS',
  zones: [{ zone_id: 'Z01', methane_fraction: 0.001, co_ppm: 5 }, { zone_id: 'Z04', methane_fraction: 0.016, co_ppm: 12.5 }],
  airways: [{ airway_id: 'E01', flow_m3s: 17.5 }],
  fans: [{ fan_id: 'FAN_MAIN', actual_speed_fraction: 1, actual_speed_rpm: 1200, faulted: false, power_kw: 160 }],
  risks: [
    { zone_id: 'Z01', state: 'NORMAL', reason_codes: ['WITHIN_LIMITS'], quality: 'GOOD', methane_fraction: 0.001, co_ppm: 5, airflow_m3s: 17.5 },
    { zone_id: 'Z04', state: 'EMERGENCY', reason_codes: ['METHANE_EMERGENCY'], quality: 'GOOD', methane_fraction: 0.016, co_ppm: 12.5, airflow_m3s: 17.5 },
  ],
  safety: [],
} satisfies Snapshot

describe('3D mine scene mapping', () => {
  it('maps live topology, methane, airflow and fan state into spatial entities', () => {
    const scene = buildMineScene(topology, snapshot)
    expect(scene.zones).toHaveLength(2)
    expect(scene.zones.find((zone) => zone.id === 'Z04')).toMatchObject({ methanePercent: 1.6, coPpm: 12.5, risk: 'EMERGENCY', depthM: 450 })
    expect(scene.airways[0]).toMatchObject({ id: 'E01', flowM3s: 17.5 })
    expect(scene.fans[0]).toMatchObject({ id: 'FAN_MAIN', speedFraction: 1, actualRpm: 1200, powerKw: 160, faulted: false })
    expect(scene.zones[0]?.position).not.toEqual(scene.zones[1]?.position)
  })

  it('gives emergency precedence in the system visual state', () => {
    expect(highestRisk(snapshot)).toBe('EMERGENCY')
  })

  it('treats every zone as unknown when the live feed is stale', () => {
    const scene = buildMineScene(topology, snapshot, true)
    expect(scene.zones.every((zone) => zone.risk === 'UNKNOWN_DATA' && zone.quality === 'STALE')).toBe(true)
    expect(scene.zones.every((zone) => zone.reasons[0] === 'LIVE_FEED_STALE')).toBe(true)
    expect(scene.zones.find((zone) => zone.id === 'Z04')?.methanePercent).toBe(1.6)
    expect(scene.zones.find((zone) => zone.id === 'Z04')?.coPpm).toBe(12.5)
    expect(scene.zones.find((zone) => zone.id === 'Z04')?.risk).not.toBe('NORMAL')
  })

  it('retains actual zero RPM and zero airflow for a failed fan', () => {
    const failedSnapshot: Snapshot = structuredClone(snapshot)
    failedSnapshot.fans[0] = { fan_id: 'FAN_MAIN', actual_speed_fraction: 0, actual_speed_rpm: 0, faulted: true, power_kw: 0 }
    failedSnapshot.airways[0].flow_m3s = 0
    const scene = buildMineScene(topology, failedSnapshot)
    expect(scene.fans[0]).toMatchObject({ actualRpm: 0, speedFraction: 0, faulted: true, powerKw: 0 })
    expect(scene.airways[0].flowM3s).toBe(0)
  })
})
