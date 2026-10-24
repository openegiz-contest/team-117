import { useContext, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { MineMaterial } from './RenderMaterials'
import { industrialBounds } from './industrialLayout'
import type { IndustrialBounds } from './industrialLayout'
import { SoftwareRenderer } from './renderQuality'
import type { MineSceneModel, SceneZone } from './sceneModel'
import { RISK_COLOURS, RISK_PRIORITY } from './sceneModel'

type Placement = {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

function InstancedPart({ geometry, placements, colour, emissive = '#000000' }: {
  geometry: THREE.BufferGeometry
  placements: Placement[]
  colour: string
  emissive?: string
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const object = new THREE.Object3D()
    placements.forEach((placement, index) => {
      object.position.set(...placement.position)
      object.rotation.set(...(placement.rotation ?? [0, 0, 0]))
      object.scale.set(...(placement.scale ?? [1, 1, 1]))
      object.updateMatrix()
      mesh.current?.setMatrixAt(index, object.matrix)
    })
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true
      mesh.current.computeBoundingSphere()
    }
  }, [placements])
  return <instancedMesh ref={mesh} args={[geometry, undefined, placements.length]} receiveShadow>
    <MineMaterial color={colour} emissive={emissive} emissiveIntensity={0.1} roughness={0.94} metalness={0.08} flatShading />
  </instancedMesh>
}

function GeologicalCutaway({ bounds }: { bounds: IndustrialBounds }) {
  const rockGeometry = useMemo(() => new THREE.DodecahedronGeometry(0.72, 0), [])
  const placements = useMemo<Placement[]>(() => {
    const output: Placement[] = []
    let seed = 2026
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647
      return (seed - 1) / 2_147_483_646
    }
    const rearZ = bounds.centreZ - bounds.depth / 2 - 1.2
    for (let index = 0; index < 110; index += 1) {
      const side = index % 5
      const x = side < 3
        ? bounds.centreX + (random() - 0.5) * (bounds.width + 5)
        : bounds.centreX + (side === 3 ? -1 : 1) * (bounds.width / 2 + 1 + random() * 1.5)
      const z = side < 3
        ? rearZ - random() * 2.4
        : bounds.centreZ + (random() - 0.5) * bounds.depth
      const scale = 0.6 + random() * 1.35
      output.push({
        position: [x, bounds.floorY + 1.1 + random() * 2.5, z],
        rotation: [random() * 2.2, random() * 5.8, random() * 2.2],
        scale: [scale, scale * (0.75 + random() * 0.65), scale],
      })
    }
    return output
  }, [bounds])
  const strata = ['#34464a', '#405258', '#2a3d42']
  return <group>
    <mesh position={[bounds.centreX, bounds.floorY - 0.35, bounds.centreZ]} receiveShadow>
      <boxGeometry args={[bounds.width, 0.7, bounds.depth]} />
      <MineMaterial color="#48585b" roughness={0.97} metalness={0.05} />
    </mesh>
    {strata.map((colour, index) => <mesh key={colour} position={[bounds.centreX, bounds.floorY - 0.78 - index * 0.32, bounds.centreZ + 0.25 * index]} receiveShadow>
      <boxGeometry args={[bounds.width + index * 0.5, 0.24, bounds.depth + index * 0.55]} />
      <MineMaterial color={colour} roughness={1} flatShading />
    </mesh>)}
    <InstancedPart geometry={rockGeometry} placements={placements} colour="#536266" />
    <mesh position={[bounds.centreX, bounds.floorY + 1.5, bounds.centreZ - bounds.depth / 2 - 1.2]}>
      <boxGeometry args={[bounds.width + 3, 4.8, 1.7]} />
      <MineMaterial color="#425257" roughness={1} flatShading />
    </mesh>
  </group>
}

function ServiceDeck({ bounds }: { bounds: IndustrialBounds }) {
  const stripeGeometry = useMemo(() => new THREE.BoxGeometry(0.72, 0.025, 0.055), [])
  const stripes = useMemo<Placement[]>(() => Array.from({ length: Math.max(12, Math.floor(bounds.width / 0.9)) }, (_, index) => ({
    position: [bounds.centreX - bounds.width / 2 + 0.75 + index * 0.86, bounds.floorY + 0.075, bounds.centreZ + bounds.depth / 2 - 1.05],
  })), [bounds])
  return <group>
    <mesh position={[bounds.centreX, bounds.floorY + 0.02, bounds.centreZ]} receiveShadow>
      <boxGeometry args={[bounds.width - 1.2, 0.16, bounds.depth - 1.2]} />
      <MineMaterial color="#2f4247" roughness={0.84} metalness={0.22} />
    </mesh>
    <InstancedPart geometry={stripeGeometry} placements={stripes} colour="#e0a93f" emissive="#5a3500" />
    {[-1, 1].map((side) => <mesh key={side} position={[bounds.centreX, bounds.floorY + 0.14, bounds.centreZ + side * (bounds.depth / 2 - 0.62)]}>
      <boxGeometry args={[bounds.width - 1.4, 0.18, 0.16]} />
      <MineMaterial color="#bd8c37" metalness={0.45} roughness={0.5} />
    </mesh>)}
  </group>
}

function Conveyor({ bounds }: { bounds: IndustrialBounds }) {
  const length = bounds.width * 0.54
  const wheels = useMemo<Placement[]>(() => Array.from({ length: 14 }, (_, index) => ({
    position: [(index / 13 - 0.5) * length, -0.28, index % 2 === 0 ? -0.52 : 0.52],
    rotation: [Math.PI / 2, 0, 0],
  })), [length])
  const wheelGeometry = useMemo(() => new THREE.CylinderGeometry(0.18, 0.18, 0.14, 9), [])
  return <group position={[bounds.centreX, bounds.floorY + 0.48, bounds.centreZ + bounds.depth * 0.25]}>
    <mesh><boxGeometry args={[length, 0.28, 1.15]} /><MineMaterial color="#3e5258" metalness={0.55} roughness={0.48} /></mesh>
    <mesh position={[0, 0.19, 0]}><boxGeometry args={[length - 0.3, 0.08, 0.82]} /><MineMaterial color="#17282d" roughness={0.83} /></mesh>
    {[-0.65, 0.65].map((z) => <mesh key={z} position={[0, 0.48, z]}><boxGeometry args={[length, 0.06, 0.06]} /><MineMaterial color="#cda14b" metalness={0.5} /></mesh>)}
    <InstancedPart geometry={wheelGeometry} placements={wheels} colour="#829397" />
  </group>
}

function IntakePortal({ zone }: { zone: SceneZone }) {
  return <group position={[zone.position[0], zone.position[1] + 0.15, zone.position[2]]} rotation={[0, Math.PI / 2, 0]}>
    <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.12, 0.24, 10, 36]} /><MineMaterial color="#91a6aa" metalness={0.72} roughness={0.32} /></mesh>
    <mesh position={[0, -1.9, 0]}><boxGeometry args={[4.9, 0.32, 2.2]} /><MineMaterial color="#4f6267" roughness={0.72} /></mesh>
    <mesh position={[0, 2.1, 0]}><boxGeometry args={[2.3, 0.16, 0.18]} /><meshBasicMaterial color="#58e6eb" toneMapped={false} /></mesh>
  </group>
}

function HazardLamps({ model, bounds }: { model: MineSceneModel; bounds: IndustrialBounds }) {
  const highest = model.zones.reduce((current, zone) => RISK_PRIORITY[zone.risk] > RISK_PRIORITY[current.risk] ? zone : current, model.zones[0])
  if (!highest) return null
  const colour = RISK_COLOURS[highest.risk]
  return <group>
    {[-0.38, 0, 0.38].map((ratio) => <group key={ratio} position={[bounds.centreX + bounds.width * ratio, bounds.floorY + 0.2, bounds.centreZ - bounds.depth / 2 + 1.2]}>
      <mesh position={[0, 0.65, 0]}><cylinderGeometry args={[0.055, 0.07, 1.3, 8]} /><MineMaterial color="#71858a" metalness={0.5} /></mesh>
      <mesh position={[0, 1.34, 0]}><sphereGeometry args={[0.13, 8, 6]} /><meshBasicMaterial color={colour} toneMapped={false} /></mesh>
    </group>)}
  </group>
}

/** V3-inspired industrial context; it carries no telemetry and cannot alter the model. */
export function IndustrialCutaway({ model, visible }: { model: MineSceneModel; visible: boolean }) {
  const software = useContext(SoftwareRenderer)
  const bounds = useMemo(() => industrialBounds(model), [model])
  if (!visible) return null
  const intake = model.zones.find((zone) => zone.role === 'intake')
  return <group name="industrial-cutaway-v3">
    <GeologicalCutaway bounds={bounds} />
    <ServiceDeck bounds={bounds} />
    {!software && <Conveyor bounds={bounds} />}
    {!software && <HazardLamps model={model} bounds={bounds} />}
    {intake && <IntakePortal zone={intake} />}
  </group>
}
