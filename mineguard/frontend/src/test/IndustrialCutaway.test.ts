import { describe, expect, it } from 'vitest'

import { industrialBounds } from '../mine-map/industrialLayout'
import type { MineSceneModel } from '../mine-map/sceneModel'

describe('industrialBounds', () => {
  it('surrounds every authoritative zone with a readable minimum footprint', () => {
    const model: MineSceneModel = {
      zones: [
        { id: 'Z01', name: 'Intake', role: 'intake', depthM: 100, position: [-13, 0, 0], methanePercent: 0, coPpm: 0, airflowM3s: 40, risk: 'NORMAL', quality: 'GOOD', reasons: [], isolated: false },
        { id: 'Z04', name: 'Face', role: 'production', depthM: 350, position: [1, -2.8, 4.3], methanePercent: 1.2, coPpm: 4, airflowM3s: 28, risk: 'WARNING', quality: 'GOOD', reasons: [], isolated: false },
        { id: 'Z06', name: 'Exhaust', role: 'exhaust', depthM: 100, position: [13, 0, 0], methanePercent: 0.2, coPpm: 4, airflowM3s: 40, risk: 'NORMAL', quality: 'GOOD', reasons: [], isolated: false },
      ],
      airways: [],
      fans: [],
    }

    expect(industrialBounds(model)).toEqual({ centreX: 0, centreZ: 2.15, width: 34, depth: 16, floorY: -4.05 })
  })

  it('returns deterministic safe bounds before topology arrives', () => {
    expect(industrialBounds({ zones: [], airways: [], fans: [] })).toEqual({ centreX: 0, centreZ: 0, width: 24, depth: 16, floorY: -3.5 })
  })
})
