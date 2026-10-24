import {
  isReadiness,
  isScenarioDefinition,
  isScenarioState,
  isSnapshot,
  isTopology,
  type Readiness,
  type ScenarioDefinition,
  type ScenarioState,
  type Snapshot,
  type Topology,
} from './contracts'

const REQUEST_TIMEOUT_MS = 5000

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

async function request(path: string, signal?: AbortSignal, init: RequestInit = {}, acceptedStatuses: number[] = []): Promise<unknown> {
  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
  try {
    const response = await fetch(path, {
      ...init,
      signal: combined,
      headers: { Accept: 'application/json', ...init.headers },
    })
    if (!response.ok && !acceptedStatuses.includes(response.status)) throw new ApiError(`API request failed (${response.status})`, response.status)
    return await response.json()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(error instanceof Error ? error.message : 'API request failed')
  } finally {
    window.clearTimeout(timer)
  }
}

export async function getSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  const value = await request('/api/v1/state', signal)
  if (!isSnapshot(value)) throw new ApiError('API returned an invalid state contract')
  return value
}

export async function getReadiness(signal?: AbortSignal): Promise<Readiness> {
  const value = await request('/api/health/ready', signal, {}, [503])
  if (!isReadiness(value)) throw new ApiError('API returned an invalid readiness contract')
  return value
}

export function openStateStream(callbacks: {
  onSnapshot: (snapshot: Snapshot) => void
  onOpen?: () => void
  onError?: (message: string) => void
  onClose?: () => void
}): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/stream`)
  socket.addEventListener('open', () => callbacks.onOpen?.())
  socket.addEventListener('message', (event) => {
    try {
      const value: unknown = JSON.parse(String(event.data))
      if (!isSnapshot(value)) throw new ApiError('State stream returned an invalid snapshot')
      callbacks.onSnapshot(value)
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error.message : 'State stream failed')
      socket.close(1002, 'invalid snapshot')
    }
  })
  socket.addEventListener('error', () => {
    callbacks.onError?.('Live state stream disconnected; using HTTP fallback')
    if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'stream transport error')
  })
  socket.addEventListener('close', () => callbacks.onClose?.())
  return socket
}

export async function getTopology(signal?: AbortSignal): Promise<Topology> {
  const value = await request('/api/v1/topology', signal)
  if (!isTopology(value)) throw new ApiError('API returned an invalid topology contract')
  return value
}

export async function getHistory(signal?: AbortSignal): Promise<Snapshot[]> {
  const value = await request('/api/v1/history', signal)
  if (!Array.isArray(value) || !value.every(isSnapshot)) {
    throw new ApiError('API returned an invalid history contract')
  }
  return value
}

export async function getTwin(thingId: string, signal?: AbortSignal): Promise<unknown> {
  return request(`/api/v1/twins/${encodeURIComponent(thingId)}`, signal)
}

export async function getScenarios(signal?: AbortSignal): Promise<ScenarioDefinition[]> {
  const value = await request('/api/v1/scenarios', signal)
  if (!Array.isArray(value) || !value.every(isScenarioDefinition)) {
    throw new ApiError('API returned an invalid scenario definition contract')
  }
  return value
}

export async function getScenarioState(signal?: AbortSignal): Promise<ScenarioState> {
  const value = await request('/api/v1/scenarios/state', signal)
  if (!isScenarioState(value)) throw new ApiError('API returned an invalid scenario state contract')
  return value
}

export async function scenarioCommand(path: string): Promise<ScenarioState> {
  const value = await request(`/api/v1/scenarios/${path}`, undefined, {
    method: 'POST',
    headers: { 'X-MineGuard-Simulation': 'SIMULATION_ONLY' },
  })
  if (!isScenarioState(value)) throw new ApiError('API returned an invalid scenario state contract')
  return value
}

export async function getDecisionTrace(signal?: AbortSignal): Promise<Record<string, unknown>> {
  return (await request('/api/v1/decision-trace', signal)) as Record<string, unknown>
}

export async function getEvidence(signal?: AbortSignal): Promise<Record<string, unknown>> {
  return (await request('/api/v1/evidence', signal)) as Record<string, unknown>
}
