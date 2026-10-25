import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Topology } from '../api/contracts'
import { NetworkMap } from '../mine-map/NetworkMap'
import type { MineSceneModel } from '../mine-map/sceneModel'

afterEach(() => cleanup())

const topology: Topology = {
  simulation_only: true,
  mine_id: 'mineguard:mine-01',
  zones: [
    { id: 'Z02', name: 'Gallery', role: 'distribution', volume_m3: 3600, depth_m: 280, x: 200, y: 180 },
    { id: 'Z04', name: 'Face', role: 'production', volume_m3: 1800, depth_m: 350, x: 400, y: 280 },
  ],
  airways: [{ id: 'E03', from: 'Z02', to: 'Z04', flow_m3s: 28 }],
  fans: [{ id: 'FAN_MAIN', zone_id: 'Z04', rated_speed_rpm: 980 }],
}

const model = (flow: number, factor: number, faulted: boolean): MineSceneModel => ({
  zones: [
    { id: 'Z02', name: 'Gallery', role: 'distribution', depthM: 280, position: [0, 0, 0], methanePercent: 0.002, coPpm: 2, airflowM3s: 40, risk: 'NORMAL', quality: 'GOOD', reasons: [], isolated: false },
    { id: 'Z04', name: 'Face', role: 'production', depthM: 350, position: [1, 0, 1], methanePercent: 1.62, coPpm: 9, airflowM3s: flow, risk: 'EMERGENCY', quality: 'GOOD', reasons: [], isolated: true },
  ],
  airways: [{ id: 'E03', sourceZoneId: 'Z02', targetZoneId: 'Z04', source: [0, 0, 0], target: [1, 0, 1], flowM3s: flow, resistanceFactor: factor }],
  fans: [{ id: 'FAN_MAIN', position: [0, 0, 0], speedFraction: faulted ? 0 : 0.75, actualRpm: faulted ? 0 : 735, powerKw: 60, faulted }],
})

it('draws live airway flow, obstruction and fan state from the scene model', () => {
  const { container } = render(<NetworkMap topology={topology} model={model(6.4, 12, false)} selected="Z04" onSelect={() => undefined} />)
  const airway = container.querySelector('[data-airway="E03"]')!
  expect(airway.classList.contains('restricted')).toBe(true)
  expect(airway.textContent).toBe('E03 6.4 ×12')
  expect(container.querySelector('[data-zone="Z04"]')!.textContent).toContain('1.62%')
  expect(container.querySelector('[data-fan="FAN_MAIN"]')!.textContent).toContain('735 rpm')
})

it('shows stopped airflow and a faulted fan, and selects a zone on click', () => {
  const onSelect = vi.fn()
  const { container } = render(<NetworkMap topology={topology} model={model(0, 1, true)} selected="Z02" onSelect={onSelect} />)
  expect(container.querySelector('[data-airway="E03"]')!.classList.contains('still')).toBe(true)
  expect(container.querySelector('[data-fan="FAN_MAIN"]')!.classList.contains('faulted')).toBe(true)
  const face = container.querySelector('[data-zone="Z04"] circle') as SVGCircleElement
  expect(face.style.stroke).toBeTruthy()
  fireEvent.click(container.querySelector('[data-zone="Z04"]')!)
  expect(onSelect).toHaveBeenCalledWith('Z04')
})
