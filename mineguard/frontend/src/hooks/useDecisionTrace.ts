import { useEffect, useState } from 'react'
import { getDecisionTrace } from '../api/client'
import { parseDecisionTrace, type DecisionTrace } from '../api/decisionContract'

export function useDecisionTrace() {
  const [trace, setTrace] = useState<DecisionTrace | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer = 0
    const read = async () => {
      try {
        const next = parseDecisionTrace(await getDecisionTrace(controller.signal))
        if (!controller.signal.aborted) { setTrace(next); setError(null) }
      } catch (reason) {
        if (!controller.signal.aborted) { setTrace(null); setError(reason instanceof Error ? reason.message : 'Decision unavailable') }
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(read, 5000)
      }
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [])
  return { trace, error }
}
