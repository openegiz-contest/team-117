import type { MineSceneModel } from './sceneModel'

export interface IndustrialBounds {
  centreX: number
  centreZ: number
  width: number
  depth: number
  floorY: number
}

/** Visual bounds only. The authoritative topology remains in sceneModel. */
export function industrialBounds(model: MineSceneModel): IndustrialBounds {
  if (model.zones.length === 0) return { centreX: 0, centreZ: 0, width: 24, depth: 16, floorY: -3.5 }
  const xs = model.zones.map((zone) => zone.position[0])
  const ys = model.zones.map((zone) => zone.position[1])
  const zs = model.zones.map((zone) => zone.position[2])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return {
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
    width: Math.max(24, maxX - minX + 8),
    depth: Math.max(16, maxZ - minZ + 9),
    floorY: Math.min(...ys) - 1.25,
  }
}
