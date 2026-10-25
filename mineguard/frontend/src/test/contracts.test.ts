import { describe, expect, it } from 'vitest'

import { isScenarioDefinition } from '../api/contracts'

const base = { id: 'S', name: 'Scenario', description: 'A deterministic simulated scenario.', duration_seconds: 90 }

describe('scenario definition contract', () => {
  it('accepts each complete action type', () => {
    expect(isScenarioDefinition({ ...base, methane_source_zone_id: 'Z04', methane_source_m3s: 0.8 })).toBe(true)
    expect(isScenarioDefinition({ ...base, fan_failure_id: 'FAN_MAIN', fan_failure_at_seconds: 10 })).toBe(true)
    expect(isScenarioDefinition({ ...base, obstruction_airway_id: 'E03', obstruction_factor: 250, obstruction_at_seconds: 10 })).toBe(true)
    expect(isScenarioDefinition({ ...base, sensor_failure_zone_id: 'Z04', sensor_failure_at_seconds: 10 })).toBe(true)
  })

  it('rejects incomplete, mixed or empty actions', () => {
    expect(isScenarioDefinition(base)).toBe(false)
    expect(isScenarioDefinition({ ...base, obstruction_airway_id: 'E03', obstruction_at_seconds: 10 })).toBe(false)
    expect(isScenarioDefinition({ ...base, obstruction_airway_id: 'E03', obstruction_factor: 1, obstruction_at_seconds: 10 })).toBe(false)
    expect(isScenarioDefinition({ ...base, fan_failure_id: 'FAN_MAIN', fan_failure_at_seconds: 10, sensor_failure_zone_id: 'Z04', sensor_failure_at_seconds: 10 })).toBe(false)
  })
})
