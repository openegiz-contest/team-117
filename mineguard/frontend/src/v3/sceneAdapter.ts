import type { MineSceneModel } from '../mine-map/sceneModel'
import type { V3SceneState } from './MineEngine.js'

export function toV3SceneState(model: MineSceneModel): V3SceneState {
  const mainFan = model.fans.find((fan) => fan.id === 'FAN_MAIN') ?? model.fans[0]
  return {
    zones: model.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      descriptor: zone.role,
      ch4: zone.methanePercent,
      co: zone.coPpm,
      airflow: zone.airflowM3s,
      quality: zone.quality,
      risk: zone.risk,
      source: 'VALIDATED LIVE SNAPSHOT',
    })),
    fan: {
      rpm: mainFan?.actualRpm ?? 0,
      flow: model.zones.find((zone) => zone.role === 'intake')?.airflowM3s ?? 0,
      faulted: mainFan?.faulted ?? true,
    },
  }
}
