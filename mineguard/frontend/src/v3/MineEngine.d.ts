export interface V3ZoneState {
  id: string
  name: string
  descriptor: string
  ch4: number
  co: number
  airflow: number
  quality: string
  risk: string
  source: string
}

export interface V3SceneState {
  zones: V3ZoneState[]
  fan: { rpm: number; flow: number; faulted: boolean }
}

export interface ProjectedPosition { x: number; y: number; visible: boolean }

export class MineEngine {
  constructor(
    container: HTMLElement,
    onPositions: (positions: Record<string, ProjectedPosition>) => void,
    onSelectZone?: (id: string) => void,
  )
  setState(data: V3SceneState, selected: string, airflow: boolean, wireframe: boolean): void
  refreshLabels(): void
  recenter(): void
  destroy(): void
}
