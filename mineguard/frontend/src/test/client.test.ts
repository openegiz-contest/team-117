import { afterEach, describe, expect, it, vi } from 'vitest'

import { getReadiness, getSnapshot, openStateStream } from '../api/client'
import { isReadiness, isSnapshot, isTopology, type Snapshot } from '../api/contracts'

const validSnapshot: Snapshot = {
  tick: 12,
  simulated_seconds: 6,
  paused: false,
  simulation_only: true,
  source_type: 'SYNTHETIC_PHYSICS',
  zones: [{ zone_id: 'Z04', methane_fraction: 0.016, co_ppm: 12.5 }],
  airways: [{ airway_id: 'E04', flow_m3s: 17.5 }],
  fans: [{ fan_id: 'FAN_AUX', actual_speed_fraction: 1, actual_speed_rpm: 1200, faulted: false, power_kw: 160 }],
  risks: [{ zone_id: 'Z04', state: 'EMERGENCY', reason_codes: ['METHANE_EMERGENCY'], quality: 'GOOD', methane_fraction: 0.016, co_ppm: 12.5, airflow_m3s: 17.5 }],
  safety: [{
    zone_id: 'Z04',
    risk_state: 'EMERGENCY',
    production_stop: true,
    evacuation_advisory: true,
    ventilation_response: true,
    optimization_enabled: false,
    simulation_only: true,
    reason_codes: ['METHANE_EMERGENCY'],
    fan_requests: [{ fan_id: 'FAN_AUX', command_id: 'cmd-12', requested_speed_fraction: 1, actual_speed_fraction: 1, status: 'ACHIEVED' }],
  }],
}

class FakeWebSocket {
  static instance: FakeWebSocket | null = null

  readonly url: string
  readonly close = vi.fn()
  private readonly listeners = new Map<string, Array<EventListenerOrEventListenerObject>>()

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instance = this
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  FakeWebSocket.instance = null
})

it('rejects an invalid state instead of inventing safe data', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tick: 1 }), { status: 200 }))
  await expect(getSnapshot()).rejects.toThrow('invalid state contract')
})

it('preserves an API failure as an error', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }))
  await expect(getSnapshot()).rejects.toThrow('503')
})

it('rejects an invalid nested safety command instead of trusting a shallow envelope', async () => {
  const invalid = structuredClone(validSnapshot)
  invalid.safety[0]!.fan_requests[0]!.requested_speed_fraction = 1.2
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(invalid), { status: 200 }))

  await expect(getSnapshot()).rejects.toThrow('invalid state contract')
})

describe('readiness contract', () => {
  it('accepts explicit platform configuration and connectivity state', async () => {
    const readiness = {
      status: 'ready',
      simulation_running: true,
      simulation_error: 'NONE',
      platform_configured: true,
      platform_connected: false,
      platform_last_verified_tick: null,
      platform_error: 'Ditto unavailable',
      source_type: 'SYNTHETIC_PHYSICS',
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(readiness), { status: 200 }))

    await expect(getReadiness()).resolves.toEqual(readiness)
  })

  it('rejects readiness values with misleading field types', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: 'ready',
      simulation_running: true,
      simulation_error: 'NONE',
      platform_configured: 'yes',
      platform_connected: true,
      platform_last_verified_tick: 12,
      platform_error: '',
      source_type: 'SYNTHETIC_PHYSICS',
    }), { status: 200 }))

    await expect(getReadiness()).rejects.toThrow('invalid readiness contract')
  })

  it('reads explicit degraded readiness from HTTP 503', async () => {
    const readiness = {
      status: 'degraded', simulation_running: true, simulation_error: 'NONE',
      platform_configured: true, platform_connected: false, platform_error: 'CONNECTION_FAILED',
      platform_last_verified_tick: null,
      source_type: 'SYNTHETIC_PHYSICS',
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(readiness), { status: 503 }))
    await expect(getReadiness()).resolves.toEqual(readiness)
  })

  it('requires explicit simulation health and accepts unavailable state', () => {
    const readiness = {
      status: 'unavailable', simulation_running: false, simulation_error: 'CLOCK_STOPPED',
      platform_configured: true, platform_connected: false, platform_error: 'NONE',
      platform_last_verified_tick: null,
      source_type: 'SYNTHETIC_PHYSICS',
    }
    expect(isReadiness(readiness)).toBe(true)
    expect(isReadiness({ ...readiness, simulation_running: undefined })).toBe(false)
    expect(isReadiness({ ...readiness, simulation_running: 'true' })).toBe(false)
  })
})

describe('gas and fan measurements', () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001])('rejects impossible CO concentration %s', (value) => {
    const state = structuredClone(validSnapshot)
    state.zones[0].co_ppm = value
    expect(isSnapshot(state)).toBe(false)
    state.zones[0].co_ppm = 12.5
    state.risks[0].co_ppm = value
    expect(isSnapshot(state)).toBe(false)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid actual fan RPM %s', (value) => {
    const state = structuredClone(validSnapshot)
    state.fans[0].actual_speed_rpm = value
    expect(isSnapshot(state)).toBe(false)
  })

  it('rejects missing CO or RPM instead of inventing a zero reading', () => {
    expect(isSnapshot({ ...validSnapshot, zones: [{ zone_id: 'Z04', methane_fraction: 0.016 }] })).toBe(false)
    expect(isSnapshot({ ...validSnapshot, fans: [{ fan_id: 'FAN_AUX', actual_speed_fraction: 1, faulted: false, power_kw: 160 }] })).toBe(false)
  })

  it('requires a positive fan nameplate RPM in topology', () => {
    const topology = {
      simulation_only: true, mine_id: 'mineguard:mine-01',
      zones: [{ id: 'Z04', name: 'Face', role: 'production', volume_m3: 100, depth_m: 450, x: 1, y: 1 }],
      airways: [], fans: [{ id: 'FAN_AUX', zone_id: 'Z04', rated_speed_rpm: 1200 }],
    }
    expect(isTopology(topology)).toBe(true)
    expect(isTopology({ ...topology, fans: [{ id: 'FAN_AUX', zone_id: 'Z04', rated_speed_rpm: 0 }] })).toBe(false)
  })
})

describe('live state stream', () => {
  it('closes with a protocol error when a frame violates the snapshot contract', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onSnapshot = vi.fn()
    const onError = vi.fn()

    openStateStream({ onSnapshot, onError })
    FakeWebSocket.instance!.emit('message', new MessageEvent('message', { data: JSON.stringify({ ...validSnapshot, risks: [{ state: 'SAFE' }] }) }))

    expect(onSnapshot).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('State stream returned an invalid snapshot')
    expect(FakeWebSocket.instance!.close).toHaveBeenCalledWith(1002, 'invalid snapshot')
  })

  it('delivers a deeply validated frame to the subscriber', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onSnapshot = vi.fn()

    openStateStream({ onSnapshot })
    FakeWebSocket.instance!.emit('message', new MessageEvent('message', { data: JSON.stringify(validSnapshot) }))

    expect(onSnapshot).toHaveBeenCalledWith(validSnapshot)
    expect(FakeWebSocket.instance!.close).not.toHaveBeenCalled()
  })
})
