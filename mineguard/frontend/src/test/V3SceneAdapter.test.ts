import { expect, it } from 'vitest'

import type { MineSceneModel } from '../mine-map/sceneModel'
import { toV3SceneState } from '../v3/sceneAdapter'

it('maps validated six-zone scene state into the V3 renderer without inventing readings', () => {
  const model: MineSceneModel = {
    zones: [
      { id: 'Z01', name: 'Intake', role: 'intake', depthM: 100, position: [0, 0, 0], methanePercent: 0.002, coPpm: 2, airflowM3s: 39.6, risk: 'NORMAL', quality: 'GOOD', reasons: [], isolated: false },
      { id: 'Z04', name: 'Face', role: 'production', depthM: 350, position: [1, -2, 2], methanePercent: 1.64, coPpm: 6.9, airflowM3s: 24.7, risk: 'EMERGENCY', quality: 'GOOD', reasons: ['METHANE_HIGH'], isolated: true },
    ],
    airways: [],
    fans: [{ id: 'FAN_MAIN', position: [0, 0, 0], speedFraction: 0.75, actualRpm: 735, powerKw: 67.5, faulted: false }],
  }
  const output = toV3SceneState(model)
  expect(output.fan).toEqual({ rpm: 735, flow: 39.6 })
  expect(output.zones[1]).toMatchObject({ id: 'Z04', ch4: 1.64, co: 6.9, airflow: 24.7, quality: 'GOOD' })
  expect(output.zones.every((zone) => zone.source === 'VALIDATED LIVE SNAPSHOT')).toBe(true)
})
