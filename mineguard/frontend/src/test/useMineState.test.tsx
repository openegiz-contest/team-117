import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getHistory, getReadiness, getSnapshot, getTopology, openStateStream } from '../api/client'
import type { Readiness, Snapshot, Topology } from '../api/contracts'
import { useMineState } from '../hooks/useMineState'

vi.mock('../api/client', () => ({
  getHistory: vi.fn(), getReadiness: vi.fn(), getSnapshot: vi.fn(), getTopology: vi.fn(), openStateStream: vi.fn(),
}))

const snapshot: Snapshot = {
  tick: 12, simulated_seconds: 6, paused: false, simulation_only: true, source_type: 'SYNTHETIC_PHYSICS',
  zones: [{ zone_id: 'Z04', methane_fraction: 0.001, co_ppm: 5 }], airways: [], fans: [], risks: [], safety: [],
}
const topology: Topology = {
  mine_id: 'mineguard:mine-01', simulation_only: true,
  zones: [{ id: 'Z04', name: 'Working face', role: 'working', volume_m3: 1000, depth_m: 450, x: 1, y: 1 }], airways: [], fans: [],
}
const readiness: Readiness = {
  status: 'ready', platform_configured: true, platform_connected: true, platform_error: 'NONE', platform_last_verified_tick: 12,
  simulation_running: true, simulation_error: 'NONE', source_type: 'SYNTHETIC_PHYSICS',
}
let callbacks: Parameters<typeof openStateStream>[0]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-22T07:00:00Z'))
  vi.mocked(getTopology).mockResolvedValue(topology)
  vi.mocked(getHistory).mockResolvedValue([snapshot])
  vi.mocked(getReadiness).mockResolvedValue(readiness)
  vi.mocked(getSnapshot).mockResolvedValue(snapshot)
  vi.mocked(openStateStream).mockImplementation((handlers) => {
    callbacks = handlers
    return { readyState: WebSocket.OPEN, close: vi.fn() } as unknown as WebSocket
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('does not refresh model freshness when repeated unpaused frames stop advancing', async () => {
  const { result } = renderHook(useMineState)
  await act(async () => { await Promise.resolve() })
  act(() => callbacks.onSnapshot(snapshot))
  const initial = result.current.updatedAt
  vi.setSystemTime(Date.now() + 7000)
  act(() => callbacks.onSnapshot(snapshot))
  expect(result.current.updatedAt).toBe(initial)
  expect(Date.now() - result.current.updatedAt!).toBe(7000)
  expect(result.current.transport).toBe('STREAMING')
  act(() => callbacks.onSnapshot({ ...snapshot, tick: 13, simulated_seconds: 6.5 }))
  expect(result.current.updatedAt).toBe(Date.now())
})

it('keeps a deliberate pause fresh and clears the old run history on reset', async () => {
  const { result } = renderHook(useMineState)
  await act(async () => { await Promise.resolve() })
  act(() => callbacks.onSnapshot(snapshot))
  vi.setSystemTime(Date.now() + 7000)
  act(() => callbacks.onSnapshot({ ...snapshot, paused: true }))
  expect(result.current.updatedAt).toBe(Date.now())
  act(() => callbacks.onSnapshot({ ...snapshot, tick: 0, simulated_seconds: 0 }))
  expect(result.current.history.map((item) => item.tick)).toEqual([0])
})
