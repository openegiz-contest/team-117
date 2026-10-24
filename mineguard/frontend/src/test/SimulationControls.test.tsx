import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { SimulationControls } from '../components/SimulationControls'

it('prevents duplicate commands while a request is pending', () => {
  const onCommand = vi.fn()
  render(<SimulationControls state={{ scenario_id: 'S1', status: 'RUNNING', elapsed_seconds: 1, duration_seconds: 10, simulation_only: true, applied_actions: [] }} pending onCommand={onCommand} />)
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(onCommand).not.toHaveBeenCalled()
})
