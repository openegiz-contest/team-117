import { describe, expect, it } from 'vitest'

import type { RiskState, Snapshot } from '../api/contracts'
import { activeSafetyIncident, describeSafetyIncident, summarizeSafetyResponse } from '../pages/safetyResponse'

type Fan = Snapshot['fans'][number]
type Decision = Snapshot['safety'][number]

const fan = (fan_id: string, requested: number, actual: number, faulted = false): Fan => ({ fan_id, requested_speed_fraction: requested, actual_speed_fraction: actual, actual_speed_rpm: faulted ? 0 : actual * 980, faulted, power_kw: faulted ? 0 : 160 * actual ** 3 })

const decision = (zone_id: string, risk_state: RiskState, fans: Fan[] = [], reason_codes: string[] = []): Decision => ({
  zone_id,
  risk_state,
  production_stop: ['WARNING', 'EMERGENCY', 'UNKNOWN_DATA'].includes(risk_state),
  evacuation_advisory: ['EMERGENCY', 'UNKNOWN_DATA'].includes(risk_state),
  ventilation_response: ['ADVISORY', 'WARNING', 'EMERGENCY'].includes(risk_state),
  optimization_enabled: ['NORMAL', 'ADVISORY'].includes(risk_state),
  simulation_only: true,
  reason_codes,
  fan_requests: ['ADVISORY', 'WARNING', 'EMERGENCY'].includes(risk_state)
    ? fans.map((item) => ({ fan_id: item.fan_id, command_id: `sim-${zone_id}-${item.fan_id}`, requested_speed_fraction: 1, actual_speed_fraction: item.actual_speed_fraction, status: item.faulted ? 'EXCLUDED_FAULTED' as const : item.actual_speed_fraction === 1 ? 'ACHIEVED' as const : 'PENDING' as const }))
    : [],
})

const snapshot = (fans: Fan[], safety: Decision[], running = true): Snapshot => ({
  tick: 90, simulated_seconds: 45, paused: false, simulation_only: true, source_type: 'SYNTHETIC_PHYSICS', publication_status: 'ECLIPSE_DITTO_READBACK',
  zones: [], airways: [], risks: [], fans, safety,
  production: { equipment_id: 'SHEARER_Z04', zone_id: 'Z04', running, power_kw: running ? 600 : 0, cutting_methane_m3s: running ? 0.025 : 0, equipment_co_m3s: 0 },
})

describe('safety response summary', () => {
  it('reads baseline fans at their setpoint with no response', () => {
    const fans = [fan('FAN_AUX', 0.5, 0.5), fan('FAN_MAIN', 0.75, 0.75)]
    const summary = summarizeSafetyResponse(snapshot(fans, [decision('Z04', 'NORMAL', fans)]))
    expect(summary.fans.map((item) => [item.label, item.status])).toEqual([['MAIN', 'AT SETPOINT'], ['AUX', 'AT SETPOINT']])
    expect(summary).toMatchObject({ productionStopZones: [], evacuationZones: [], ventilation: 'NONE' })
  })

  it('shows an emergency request as PENDING while the drives ramp, then ACHIEVED at 100 %', () => {
    const ramping = [fan('FAN_AUX', 1, 0.6), fan('FAN_MAIN', 1, 0.85)]
    const pending = summarizeSafetyResponse(snapshot(ramping, [decision('Z04', 'EMERGENCY', ramping)], false))
    expect(pending.fans.map((item) => item.status)).toEqual(['PENDING', 'PENDING'])
    expect(pending.fans[0]).toMatchObject({ requestedPercent: 100, actualPercent: 85 })
    expect(pending).toMatchObject({ productionStopZones: ['Z04'], productionRunning: false, evacuationZones: ['Z04'], ventilation: 'COMMANDED' })
    const reached = [fan('FAN_AUX', 1, 1), fan('FAN_MAIN', 1, 1)]
    const achieved = summarizeSafetyResponse(snapshot(reached, [decision('Z04', 'EMERGENCY', reached)], false))
    expect(achieved.fans.map((item) => item.status)).toEqual(['ACHIEVED', 'ACHIEVED'])
  })

  it('keeps warning fan requests as proposals: no evacuation and fans stay at setpoint', () => {
    const fans = [fan('FAN_AUX', 0.5, 0.5), fan('FAN_MAIN', 0.75, 0.75)]
    const summary = summarizeSafetyResponse(snapshot(fans, [decision('Z04', 'WARNING', fans)], false))
    expect(summary).toMatchObject({ productionStopZones: ['Z04'], evacuationZones: [], ventilation: 'PROPOSED' })
    expect(summary.fans.every((item) => item.status === 'AT SETPOINT')).toBe(true)
  })

  it('reports a failed main fan as FAULTED and an applied VOD ramp as PENDING', () => {
    const failed = [fan('FAN_AUX', 1, 0.7), fan('FAN_MAIN', 0.75, 0, true)]
    const s2 = summarizeSafetyResponse(snapshot(failed, [decision('Z01', 'EMERGENCY', failed, ['FAN_FAILED', 'FAILED_FAN_EXCLUDED'])]))
    expect(s2.fans.map((item) => [item.label, item.status])).toEqual([['MAIN', 'FAULTED'], ['AUX', 'PENDING']])
    const vod = [fan('FAN_AUX', 0.4, 0.45), fan('FAN_MAIN', 0.6, 0.7)]
    expect(summarizeSafetyResponse(snapshot(vod, [decision('Z04', 'NORMAL', vod)])).fans.map((item) => item.status)).toEqual(['PENDING', 'PENDING'])
  })
})

describe('incident popup copy', () => {
  it('names only the active actions of the most severe zone', () => {
    const fans = [fan('FAN_AUX', 0.5, 0.5), fan('FAN_MAIN', 0.75, 0.75)]
    const warning = describeSafetyIncident(activeSafetyIncident(snapshot(fans, [decision('Z04', 'WARNING', fans), decision('Z05', 'ADVISORY', fans)]))!)
    expect(warning.title).toBe('Production stop (power isolation)')
    expect(warning.actions.join(' ')).not.toMatch(/evacuation/i)
    const worst = activeSafetyIncident(snapshot(fans, [decision('Z04', 'WARNING', fans), decision('Z05', 'EMERGENCY', fans)]))!
    expect(worst.zone_id).toBe('Z05')
    const emergency = describeSafetyIncident(worst)
    expect(emergency.title).toBe('Power isolation and evacuation advisory')
    expect(emergency.actions).toContain('Evacuation advisory for Z05 (simulated)')
    expect(activeSafetyIncident(snapshot(fans, [decision('Z04', 'NORMAL', fans)]))).toBeUndefined()
  })
})
