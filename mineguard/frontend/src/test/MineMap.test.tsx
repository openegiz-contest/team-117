import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Snapshot, Topology } from '../api/contracts'
import { MineMap } from '../mine-map/MineMap'

vi.mock('../mine-map/webgl', () => ({ canRenderWebGL: () => false }))

afterEach(cleanup)

const topology = { simulation_only: true, mine_id: 'mineguard:mine-01', zones: [{ id: 'Z01', name: 'Intake', role: 'intake', volume_m3: 10, depth_m: 1, x: 50, y: 50 }], airways: [], fans: [] } satisfies Topology
const snapshot = { tick: 0, simulated_seconds: 0, paused: false, simulation_only: true, source_type: 'SYNTHETIC_PHYSICS', zones: [{ zone_id: 'Z01', methane_fraction: 0.001, co_ppm: 12.5 }], airways: [], fans: [], risks: [{ zone_id: 'Z01', state: 'UNKNOWN_DATA', reason_codes: ['SENSOR_STALE'], quality: 'STALE', methane_fraction: 0.001, co_ppm: 12.5, airflow_m3s: 0 }], safety: [] } satisfies Snapshot

it('exposes unknown data and CO units in the selected zone', () => {
  const onSelect = vi.fn()
  render(<MineMap topology={topology} snapshot={snapshot} selected="Z01" onSelect={onSelect} stale={false} platformConfigured platformConnected />)
  const zone = screen.getByRole('button', { name: 'Select Z01 Intake' })
  expect(zone.getAttribute('class')).toContain('unknown_data')
  fireEvent.click(zone)
  expect(onSelect).toHaveBeenCalledWith('Z01')
  expect(screen.getByText('Carbon monoxide')).toBeTruthy()
  expect(screen.getByText('ppm')).toBeTruthy()
  expect(screen.getByText('12.5')).toBeTruthy()
})

it('keeps the non-WebGL topology operable with Enter and Space', () => {
  const onSelect = vi.fn()
  render(<MineMap topology={topology} snapshot={snapshot} selected="Z01" onSelect={onSelect} stale={false} platformConfigured platformConnected />)
  expect(screen.getByRole('button', { name: 'Show interactive 3D view' }).hasAttribute('disabled')).toBe(true)
  const zone = screen.getByRole('button', { name: /Select Z01 Intake, UNKNOWN DATA, methane/ })
  expect(zone.getAttribute('tabindex')).toBe('0')
  fireEvent.keyDown(zone, { key: 'Enter' })
  fireEvent.keyDown(zone, { key: ' ' })
  expect(onSelect).toHaveBeenNthCalledWith(1, 'Z01')
  expect(onSelect).toHaveBeenNthCalledWith(2, 'Z01')
  fireEvent.keyDown(zone, { key: 'ArrowRight' })
  expect(onSelect).toHaveBeenCalledTimes(2)
})
