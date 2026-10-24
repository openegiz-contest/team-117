export type RiskState = 'NORMAL' | 'ADVISORY' | 'WARNING' | 'EMERGENCY' | 'UNKNOWN_DATA'
export type Quality = 'GOOD' | 'STALE' | 'INVALID'

export interface Zone {
  id: string
  name: string
  role: string
  volume_m3: number
  depth_m: number
  x: number
  y: number
}

export interface Airway {
  id: string
  from: string
  to: string
  flow_m3s: number
}

export interface Topology {
  mine_id: string
  simulation_only: true
  zones: Zone[]
  airways: Airway[]
  fans: Array<{ id: string; zone_id: string; rated_speed_rpm: number }>
}

export interface Snapshot {
  tick: number
  simulated_seconds: number
  paused: boolean
  simulation_only: true
  source_type: 'SYNTHETIC_PHYSICS'
  /** ECLIPSE_DITTO_READBACK when rebuilt from the platform; LOCAL_MODEL_SNAPSHOT only without a platform. */
  publication_status?: 'LOCAL_MODEL_SNAPSHOT' | 'ECLIPSE_DITTO_READBACK'
  zones: Array<{ zone_id: string; methane_fraction: number; co_ppm: number }>
  airways: Array<{ airway_id: string; flow_m3s: number }>
  fans: Array<{
    fan_id: string
    actual_speed_fraction: number
    actual_speed_rpm: number
    faulted: boolean
    power_kw: number
  }>
  risks: Array<{
    zone_id: string
    state: RiskState
    reason_codes: string[]
    quality: Quality
    methane_fraction: number
    co_ppm: number
    airflow_m3s: number
  }>
  safety: Array<{
    zone_id: string
    risk_state: RiskState
    production_stop: boolean
    evacuation_advisory: boolean
    ventilation_response: boolean
    optimization_enabled: boolean
    simulation_only: true
    reason_codes: string[]
    fan_requests: Array<{
      fan_id: string
      command_id: string
      requested_speed_fraction: number
      actual_speed_fraction: number
      status: 'PENDING' | 'ACHIEVED' | 'EXCLUDED_FAULTED'
    }>
  }>
}

export interface ScenarioDefinition {
  id: string
  name: string
  description: string
  duration_seconds: number
  methane_source_zone_id?: string | null
  methane_source_m3s?: number | null
  fan_failure_id?: string | null
  fan_failure_at_seconds?: number | null
}

export interface ScenarioState {
  scenario_id: string | null
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED'
  elapsed_seconds: number
  duration_seconds: number
  simulation_only: true
  applied_actions: string[]
}

export interface Readiness {
  status: 'ready' | 'degraded' | 'unavailable'
  simulation_running: boolean
  simulation_error: string
  platform_configured: boolean
  platform_connected: boolean
  platform_last_verified_tick: number | null
  platform_error: string
  source_type: 'SYNTHETIC_PHYSICS'
}

const RISK_STATES: readonly RiskState[] = ['NORMAL', 'ADVISORY', 'WARNING', 'EMERGENCY', 'UNKNOWN_DATA']
const QUALITIES: readonly Quality[] = ['GOOD', 'STALE', 'INVALID']
const FAN_REQUEST_STATUSES = ['PENDING', 'ACHIEVED', 'EXCLUDED_FAULTED'] as const
const SCENARIO_STATUSES: readonly ScenarioState['status'][] = ['IDLE', 'RUNNING', 'PAUSED', 'COMPLETED']

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonnegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isFraction(value: unknown): value is number {
  return isNonnegative(value) && value <= 1
}

function isPpm(value: unknown): value is number {
  return isNonnegative(value) && value <= 1_000_000
}

function isIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isIdentifier)
}

function isOneOf<T extends string>(value: unknown, candidates: readonly T[]): value is T {
  return typeof value === 'string' && candidates.includes(value as T)
}

function isZone(value: unknown): value is Zone {
  if (!isRecord(value)) return false
  return (
    isIdentifier(value.id) &&
    isIdentifier(value.name) &&
    isIdentifier(value.role) &&
    isFiniteNumber(value.volume_m3) &&
    value.volume_m3 > 0 &&
    isNonnegative(value.depth_m) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  )
}

function isAirway(value: unknown): value is Airway {
  if (!isRecord(value)) return false
  return isIdentifier(value.id) && isIdentifier(value.from) && isIdentifier(value.to) && isNonnegative(value.flow_m3s)
}

function isTopologyFan(value: unknown): value is Topology['fans'][number] {
  if (!isRecord(value)) return false
  return isIdentifier(value.id) && isIdentifier(value.zone_id) && isFiniteNumber(value.rated_speed_rpm) && value.rated_speed_rpm > 0
}

function isZoneConcentration(value: unknown): value is Snapshot['zones'][number] {
  if (!isRecord(value)) return false
  return isIdentifier(value.zone_id) && isFraction(value.methane_fraction) && isPpm(value.co_ppm)
}

function isAirwayFlow(value: unknown): value is Snapshot['airways'][number] {
  if (!isRecord(value)) return false
  return isIdentifier(value.airway_id) && isNonnegative(value.flow_m3s)
}

function isFanState(value: unknown): value is Snapshot['fans'][number] {
  if (!isRecord(value)) return false
  return (
    isIdentifier(value.fan_id) &&
    isFraction(value.actual_speed_fraction) &&
    isNonnegative(value.actual_speed_rpm) &&
    typeof value.faulted === 'boolean' &&
    isNonnegative(value.power_kw)
  )
}

function isRiskAssessment(value: unknown): value is Snapshot['risks'][number] {
  if (!isRecord(value)) return false
  return (
    isIdentifier(value.zone_id) &&
    isOneOf(value.state, RISK_STATES) &&
    isIdentifierArray(value.reason_codes) &&
    isOneOf(value.quality, QUALITIES) &&
    isFraction(value.methane_fraction) &&
    isPpm(value.co_ppm) &&
    isNonnegative(value.airflow_m3s)
  )
}

function isFanRequest(value: unknown): value is Snapshot['safety'][number]['fan_requests'][number] {
  if (!isRecord(value)) return false
  return (
    isIdentifier(value.fan_id) &&
    isIdentifier(value.command_id) &&
    isFraction(value.requested_speed_fraction) &&
    isFraction(value.actual_speed_fraction) &&
    isOneOf(value.status, FAN_REQUEST_STATUSES)
  )
}

function isSafetyDecision(value: unknown): value is Snapshot['safety'][number] {
  if (!isRecord(value)) return false
  return (
    isIdentifier(value.zone_id) &&
    isOneOf(value.risk_state, RISK_STATES) &&
    typeof value.production_stop === 'boolean' &&
    typeof value.evacuation_advisory === 'boolean' &&
    typeof value.ventilation_response === 'boolean' &&
    typeof value.optimization_enabled === 'boolean' &&
    value.simulation_only === true &&
    isIdentifierArray(value.reason_codes) &&
    Array.isArray(value.fan_requests) &&
    value.fan_requests.every(isFanRequest)
  )
}

export function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false
  return (
    value.simulation_only === true &&
    value.source_type === 'SYNTHETIC_PHYSICS' &&
    Number.isInteger(value.tick) &&
    isNonnegative(value.tick) &&
    isNonnegative(value.simulated_seconds) &&
    typeof value.paused === 'boolean' &&
    Array.isArray(value.zones) &&
    value.zones.every(isZoneConcentration) &&
    Array.isArray(value.airways) &&
    value.airways.every(isAirwayFlow) &&
    Array.isArray(value.fans) &&
    value.fans.every(isFanState) &&
    Array.isArray(value.risks) &&
    value.risks.every(isRiskAssessment) &&
    Array.isArray(value.safety) &&
    value.safety.every(isSafetyDecision)
  )
}

export function isTopology(value: unknown): value is Topology {
  if (!isRecord(value)) return false
  return (
    value.simulation_only === true &&
    isIdentifier(value.mine_id) &&
    Array.isArray(value.zones) &&
    value.zones.length > 0 &&
    value.zones.every(isZone) &&
    Array.isArray(value.airways) &&
    value.airways.every(isAirway) &&
    Array.isArray(value.fans) &&
    value.fans.every(isTopologyFan)
  )
}

export function isReadiness(value: unknown): value is Readiness {
  if (!isRecord(value)) return false
  return (
    isOneOf(value.status, ['ready', 'degraded', 'unavailable']) &&
    typeof value.simulation_running === 'boolean' &&
    typeof value.simulation_error === 'string' &&
    typeof value.platform_configured === 'boolean' &&
    typeof value.platform_connected === 'boolean' &&
    (value.platform_last_verified_tick === null || (Number.isInteger(value.platform_last_verified_tick) && isNonnegative(value.platform_last_verified_tick))) &&
    typeof value.platform_error === 'string' &&
    value.source_type === 'SYNTHETIC_PHYSICS'
  )
}

export function isScenarioDefinition(value: unknown): value is ScenarioDefinition {
  if (!isRecord(value)) return false
  const methaneZone = value.methane_source_zone_id
  const methaneRate = value.methane_source_m3s
  const fanId = value.fan_failure_id
  const fanAt = value.fan_failure_at_seconds
  const hasMethane = methaneZone != null || methaneRate != null
  const hasFan = fanId != null || fanAt != null
  const methaneValid = !hasMethane || (isIdentifier(methaneZone) && isNonnegative(methaneRate))
  const fanValid = !hasFan || (isIdentifier(fanId) && isNonnegative(fanAt))
  return (
    isIdentifier(value.id) &&
    isIdentifier(value.name) &&
    isIdentifier(value.description) &&
    isFiniteNumber(value.duration_seconds) &&
    value.duration_seconds > 0 &&
    methaneValid &&
    fanValid &&
    hasMethane !== hasFan
  )
}

export function isScenarioState(value: unknown): value is ScenarioState {
  if (!isRecord(value)) return false
  return (
    (value.scenario_id === null || isIdentifier(value.scenario_id)) &&
    isOneOf(value.status, SCENARIO_STATUSES) &&
    isNonnegative(value.elapsed_seconds) &&
    isNonnegative(value.duration_seconds) &&
    value.simulation_only === true &&
    isIdentifierArray(value.applied_actions)
  )
}
