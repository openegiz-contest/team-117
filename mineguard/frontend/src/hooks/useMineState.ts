import { useEffect, useState } from 'react'

import { getHistory, getReadiness, getSnapshot, getTopology, openStateStream } from '../api/client'
import type { Readiness, Snapshot, Topology } from '../api/contracts'

const HISTORY_LIMIT = 240
const POLL_INTERVAL_MS = 2000
const STREAM_HEARTBEAT_MS = 3500

export type TransportMode = 'CONNECTING' | 'STREAMING' | 'POLLING' | 'OFFLINE'

export function useMineState(): {
  topology: Topology | null
  snapshot: Snapshot | null
  history: Snapshot[]
  readiness: Readiness | null
  transport: TransportMode
  error: string | null
  updatedAt: number | null
} {
  const [topology, setTopology] = useState<Topology | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [transport, setTransport] = useState<TransportMode>('CONNECTING')
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let pollTimer = 0
    let reconnectTimer = 0
    let stream: WebSocket | null = null
    let topologyCache: Topology | null = null
    let historyLoaded = false
    let lastStreamAt = 0
    let lastTick = -1
    let lastSimulatedSeconds = -1

    const acceptSnapshot = (next: Snapshot, source: 'STREAMING' | 'POLLING') => {
      const resetDetected = lastTick >= 0 && (next.tick < lastTick || next.simulated_seconds < lastSimulatedSeconds)
      const isNewSample = resetDetected || next.tick > lastTick || next.simulated_seconds > lastSimulatedSeconds
      if (resetDetected) {
        setHistory([next])
      } else if (isNewSample) {
        setHistory((current) => [...current, next].slice(-HISTORY_LIMIT))
      }
      lastTick = next.tick
      lastSimulatedSeconds = next.simulated_seconds
      setSnapshot(next)
      // Receiving a repeated frame proves transport activity, not a moving model.
      // A deliberate pause still has a valid current reading; runtime health is
      // checked independently by the readiness endpoint.
      if (isNewSample || next.paused) setUpdatedAt(Date.now())
      setTransport(source)
      setError(null)
    }

    const hydrateHistory = (incoming: Snapshot[]) => {
      setHistory((current) => {
        const merged = new Map<string, Snapshot>()
        for (const item of [...incoming, ...current]) {
          merged.set(`${item.tick}:${item.simulated_seconds}`, item)
        }
        return [...merged.values()]
          .sort((left, right) => left.simulated_seconds - right.simulated_seconds || left.tick - right.tick)
          .slice(-HISTORY_LIMIT)
      })
    }

    const scheduleReconnect = () => {
      window.clearTimeout(reconnectTimer)
      if (!controller.signal.aborted) reconnectTimer = window.setTimeout(connect, POLL_INTERVAL_MS)
    }

    const connect = () => {
      if (controller.signal.aborted || stream?.readyState === WebSocket.CONNECTING || stream?.readyState === WebSocket.OPEN) return
      setTransport((current) => current === 'STREAMING' ? current : 'CONNECTING')
      let candidate: WebSocket | null = null
      try {
        candidate = openStateStream({
          onSnapshot: (next) => {
            lastStreamAt = Date.now()
            acceptSnapshot(next, 'STREAMING')
          },
          onOpen: () => {
            lastStreamAt = Date.now()
            setTransport('STREAMING')
            setError(null)
          },
          onError: () => {
            setTransport('POLLING')
          },
          onClose: () => {
            if (stream === candidate) stream = null
            setTransport((current) => current === 'OFFLINE' ? current : 'POLLING')
            scheduleReconnect()
          },
        })
        stream = candidate
      } catch {
        stream = null
        setTransport('POLLING')
        scheduleReconnect()
      }
    }
    connect()

    const poll = async () => {
      try {
        const streamHealthy = stream?.readyState === WebSocket.OPEN && Date.now() - lastStreamAt <= STREAM_HEARTBEAT_MS
        if (stream?.readyState === WebSocket.OPEN && !streamHealthy) {
          stream.close(4000, 'stream heartbeat timed out')
        }
        const [nextTopology, initialHistory, nextReadiness, fallbackSnapshot] = await Promise.all([
          topologyCache ? Promise.resolve(topologyCache) : getTopology(controller.signal),
          historyLoaded ? Promise.resolve(null) : getHistory(controller.signal),
          getReadiness(controller.signal),
          streamHealthy ? Promise.resolve(null) : getSnapshot(controller.signal),
        ])
        topologyCache = nextTopology
        setTopology(nextTopology)
        setReadiness(nextReadiness)
        if (initialHistory) {
          hydrateHistory(initialHistory)
          historyLoaded = true
        }
        if (fallbackSnapshot) acceptSnapshot(fallbackSnapshot, 'POLLING')
      } catch (reason) {
        if (!controller.signal.aborted) {
          setTransport('OFFLINE')
          setError(reason instanceof Error ? reason.message : 'Mine state unavailable')
        }
      } finally {
        if (!controller.signal.aborted) pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }
    void poll()

    return () => {
      controller.abort()
      window.clearTimeout(pollTimer)
      window.clearTimeout(reconnectTimer)
      stream?.close()
    }
  }, [])

  return { topology, snapshot, history, readiness, transport, error, updatedAt }
}
