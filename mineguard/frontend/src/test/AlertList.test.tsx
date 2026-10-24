import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import type { Snapshot } from '../api/contracts'
import { AlertList } from '../components/AlertList'

const normalSnapshot: Snapshot = {
  tick: 1,
  simulated_seconds: 0.5,
  paused: false,
  simulation_only: true,
  source_type: 'SYNTHETIC_PHYSICS',
  zones: [{ zone_id: 'Z01', methane_fraction: 0.001, co_ppm: 5 }],
  airways: [],
  fans: [],
  risks: [{ zone_id: 'Z01', state: 'NORMAL', reason_codes: ['WITHIN_LIMITS'], quality: 'GOOD', methane_fraction: 0.001, co_ppm: 5, airflow_m3s: 20 }],
  safety: [],
}

it('announces stale telemetry as unknown rather than presenting the retained reading as safe', () => {
  render(<AlertList snapshot={normalSnapshot} stale />)

  expect(screen.getByRole('region', { name: 'Active conditions' })).toBeTruthy()
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('UNKNOWN DATA')
  expect(alert.textContent).toContain('not classified as safe')
  expect(screen.queryByText('No model constraints are currently exceeded.')).toBeNull()
})
