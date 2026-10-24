import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getEvidence, getScenarioState, getTwin, scenarioCommand } from '../api/client'
import type { ScenarioState } from '../api/contracts'
import { useDecisionTrace } from '../hooks/useDecisionTrace'
import { useMineState } from '../hooks/useMineState'
import EvidenceDashboard from './EvidenceDashboard.jsx'
import FinalThreePages from './FinalThreePages.jsx'
import { toPatchedDashboardData } from './patchedDashboardAdapter'

type PatchView = 'twin' | 'command' | 'scenario' | 'energy' | 'evidence'

const routes: Record<PatchView, string> = {
  twin: '/twins',
  command: '/',
  scenario: '/scenarios',
  energy: '/energy',
  evidence: '/evidence',
}

const idle: ScenarioState = {
  scenario_id: null,
  status: 'IDLE',
  elapsed_seconds: 0,
  duration_seconds: 0,
  simulation_only: true,
  applied_actions: [],
}

function usePatchedPageState(loadTwinReadbacks = false) {
  const mine = useMineState()
  const { trace, error: decisionError } = useDecisionTrace()
  const [scenario, setScenario] = useState<ScenarioState>(idle)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [twinReadbacks, setTwinReadbacks] = useState<Record<string, unknown>>({})
  const [twinError, setTwinError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer = 0
    const read = async () => {
      try {
        const next = await getScenarioState(controller.signal)
        if (!controller.signal.aborted) {
          setScenario(next)
          setScenarioError(null)
        }
      } catch (reason) {
        if (!controller.signal.aborted) setScenarioError(reason instanceof Error ? reason.message : 'Scenario state unavailable')
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(read, 1000)
      }
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!loadTwinReadbacks || !mine.topology) return
    const controller = new AbortController()
    let timer = 0
    const ids = [
      mine.topology.mine_id,
      ...mine.topology.zones.map((zone) => `mineguard:zone-${zone.id.toLowerCase()}`),
      ...mine.topology.fans.map((fan) => `mineguard:${fan.id.toLowerCase().replaceAll('_', '-')}`),
    ]
    const read = async () => {
      const results = await Promise.allSettled(ids.map(async (id) => [id, await getTwin(id, controller.signal)] as const))
      if (controller.signal.aborted) return
      const next = Object.fromEntries(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
      if (Object.keys(next).length) {
        setTwinReadbacks(next)
        setTwinError(Object.keys(next).length === ids.length ? null : `Ditto readback received for ${Object.keys(next).length}/${ids.length} entities`)
      } else {
        setTwinError('Eclipse Ditto readback unavailable')
      }
      timer = window.setTimeout(read, 15_000)
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [loadTwinReadbacks, mine.topology])

  const execute = async (path: string) => {
    setPending(true)
    setScenarioError(null)
    try {
      const next = await scenarioCommand(path)
      setScenario(next)
      return next
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Simulation command failed'
      setScenarioError(message)
      throw new Error(message, { cause: reason })
    } finally {
      setPending(false)
    }
  }

  const data = useMemo(() => mine.topology && mine.snapshot
    ? toPatchedDashboardData(mine.topology, mine.snapshot, scenario, trace, mine.readiness, mine.updatedAt, twinReadbacks)
    : null, [mine.topology, mine.snapshot, mine.readiness, mine.updatedAt, scenario, trace, twinReadbacks])

  return {
    data,
    trace,
    pending,
    error: mine.error ?? scenarioError ?? decisionError ?? twinError,
    startScenario: (id: string) => execute(`${id}/start`),
    pause: () => execute(scenario.status === 'PAUSED' ? 'resume' : 'pause'),
    reset: () => execute('reset'),
  }
}

function usePatchNavigation() {
  const navigate = useNavigate()
  return (view: PatchView) => navigate(routes[view])
}

export function PatchedOperationalPage({ view }: { view: 'twin' | 'scenario' | 'energy' }) {
  const state = usePatchedPageState(view === 'twin')
  const navigate = usePatchNavigation()
  return <FinalThreePages
    view={view}
    setView={navigate}
    data={state.data}
    error={state.error}
    pending={state.pending}
    startScenario={state.startScenario}
    pause={state.pause}
    reset={state.reset}
  />
}

export function PatchedEvidencePage() {
  const state = usePatchedPageState()
  const navigate = usePatchNavigation()
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer = 0
    const read = () => {
      void getEvidence(controller.signal)
        .then((value) => { setEvidence(value); setEvidenceError(null) })
        .catch((reason: Error) => { if (!controller.signal.aborted) setEvidenceError(reason.message) })
        .finally(() => { if (!controller.signal.aborted) timer = window.setTimeout(read, 10_000) })
    }
    read()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [])

  const data = state.data ? { ...state.data, evidence } : null
  return <EvidenceDashboard
    data={data}
    error={state.error ?? evidenceError}
    onNavigate={navigate}
  />
}
