import { useContext, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MineMaterial } from './RenderMaterials'
import { SoftwareRenderer } from './renderQuality'

function RepeatedPart({ geometry, placements, color, unlit = false }: {
  geometry: THREE.BufferGeometry
  placements: { position: [number, number, number]; rotation?: [number, number, number] }[]
  color: string
  unlit?: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const object = new THREE.Object3D()
    placements.forEach((part, i) => {
      object.position.set(...part.position)
      object.rotation.set(...(part.rotation ?? [0, 0, 0]))
      object.updateMatrix()
      mesh.current?.setMatrixAt(i, object.matrix)
    })
    if (mesh.current) { mesh.current.instanceMatrix.needsUpdate = true; mesh.current.computeBoundingSphere() }
  }, [placements])
  return <instancedMesh ref={mesh} args={[geometry, undefined, placements.length]}>
    {unlit ? <meshBasicMaterial color={color} /> : <MineMaterial color={color} roughness={0.7} metalness={0.25} />}
  </instancedMesh>
}

/** Low-poly, deterministic, illustrative geology. No external assets or inferred geological data. */
export function RockBed({ length }: { length: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const count = Math.max(12, Math.ceil(length * 3))
  const geometry = useMemo(() => {
    const shape = new THREE.IcosahedronGeometry(1, 1)
    const p = shape.attributes.position
    for (let i = 0; i < p.count; i++) {
      const scale = 0.83 + 0.17 * Math.sin(p.getX(i) * 17 + p.getY(i) * 11 + p.getZ(i) * 5)
      p.setXYZ(i, p.getX(i) * scale, p.getY(i) * scale, p.getZ(i) * scale)
    }
    shape.computeVertexNormals()
    return shape
  }, [])
  useLayoutEffect(() => {
    const object = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? -1 : 1
      object.position.set((Math.floor(i / 2) / Math.ceil(count / 2) - 0.5) * length, -1.05, side * 2.1)
      object.rotation.set(i * 0.37, i * 1.17, i * 0.09)
      object.scale.set(0.7 + (i % 3) * 0.17, 0.52, 0.65)
      object.updateMatrix()
      mesh.current?.setMatrixAt(i, object.matrix)
    }
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true
  }, [count, length])
  return <instancedMesh ref={mesh} args={[geometry, undefined, count]}><MineMaterial color="#657579" roughness={1} flatShading /></instancedMesh>
}

export function TunnelInfrastructure({ length }: { length: number }) {
  const software = useContext(SoftwareRenderer)
  const ribs = Math.max(2, Math.floor(length / 2))
  const arch = useMemo(() => Array.from({ length: 13 }, (_, i) => {
    const angle = i / 12 * Math.PI
    return new THREE.Vector3(0, 0.5 + Math.sin(angle) * 1.5, Math.cos(angle) * 1.65)
  }), [])
  const archGeometry = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch), 16, 0.065, 5, false), [arch])
  const geometries = useMemo(() => ({
    upright: new THREE.BoxGeometry(0.11, 1.1, 0.11),
    light: new THREE.BoxGeometry(0.2, 0.05, 0.6),
    band: new THREE.TorusGeometry(0.27, 0.035, 5, 12),
    dash: new THREE.BoxGeometry(0.45, 0.025, 0.045),
  }), [])
  const xs = Array.from({ length: ribs }, (_, i) => (i / Math.max(1, ribs - 1) - 0.5) * (length - 0.8))
  if (software) return <group>
    <RepeatedPart geometry={archGeometry} placements={xs.map((x) => ({ position: [x, 0, 0] }))} color="#c4d0d2" />
    <RepeatedPart geometry={geometries.light} placements={xs.map((x) => ({ position: [x, 1.92, 0] }))} color="#d7f5fb" unlit />
    <mesh position={[0, 0.95, -1.25]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.31, 0.31, length, 10]} /><MineMaterial color="#a7bac0" metalness={0.55} roughness={0.42} /></mesh>
  </group>
  return <group>
    <RockBed length={length} />
    {[-1.4, 1.4].map((z) => <mesh key={z} position={[0, -0.59, z]}><boxGeometry args={[length, 0.025, 0.06]} /><meshBasicMaterial color="#f4c16b" /></mesh>)}
    <RepeatedPart geometry={archGeometry} placements={xs.map((x) => ({ position: [x, 0, 0] }))} color="#c4d0d2" />
    <RepeatedPart geometry={geometries.upright} placements={xs.flatMap((x) => [-1.65, 1.65].map((z) => ({ position: [x, -0.05, z] as [number, number, number] })))} color="#afc0c3" />
    <RepeatedPart geometry={geometries.light} placements={xs.map((x) => ({ position: [x, 1.92, 0] }))} color="#d7f5fb" unlit />
    <RepeatedPart geometry={geometries.band} placements={xs.map((x) => ({ position: [x, 0.95, -1.25], rotation: [0, Math.PI / 2, 0] }))} color="#b5c8cf" />
    <RepeatedPart geometry={geometries.dash} placements={xs.map((x) => ({ position: [x, -0.58, 0] }))} color="#b6ccd1" unlit />
    <mesh position={[0, 0.95, -1.25]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.31, 0.31, length, 14]} /><MineMaterial color="#a7bac0" metalness={0.55} roughness={0.42} /></mesh>
    <mesh position={[0, 0.3, 1.58]}><boxGeometry args={[length, 0.08, 0.1]} /><MineMaterial color="#c89b47" /></mesh>
    <mesh position={[0, -0.54, -1.1]}><boxGeometry args={[length, 0.025, 0.035]} /><meshBasicMaterial color="#35d9e6" toneMapped={false} /></mesh>
    {/* Roof retained only at tunnel ends; open middle is an explicit cutaway. */}
    {[-1, 1].map((side) => <mesh key={side} position={[side * (length / 2 - 0.3), 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[1.75, 1.75, 0.55, 12, 1, true, 0, Math.PI]} /><MineMaterial color="#5b6d70" side={THREE.DoubleSide} roughness={0.95} />
    </mesh>)}
  </group>
}

export function MiningEquipment({ isolated, unknown }: { isolated: boolean; unknown: boolean }) {
  return <group position={[0.3, -0.15, 0.2]} rotation={[0, -0.5, 0]} scale={0.8}>
    <mesh position={[0, 0.23, 0]}><boxGeometry args={[1.65, 0.45, 0.9]} /><MineMaterial color="#c59936" roughness={0.65} metalness={0.3} /></mesh>
    <mesh position={[-0.45, 0.7, 0]}><boxGeometry args={[0.6, 0.7, 0.8]} /><MineMaterial color="#e0b84f" /></mesh>
    <mesh position={[-0.1, 0.76, 0]}><boxGeometry args={[0.03, 0.37, 0.63]} /><MineMaterial color="#326276" metalness={0.5} /></mesh>
    <mesh position={[1.0, 0.12, 0]}><boxGeometry args={[0.7, 0.18, 1.1]} /><MineMaterial color="#687e89" /></mesh>
    {[-0.55, 0.55].flatMap((x) => [-0.52, 0.52].map((z) => <mesh key={`${x}-${z}`} position={[x, 0, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.27, 0.27, 0.18, 10]} /><MineMaterial color="#1d2b32" roughness={1} /></mesh>))}
    <mesh position={[-0.45, 1.12, 0]}><sphereGeometry args={[0.1, 8, 8]} /><meshBasicMaterial color={unknown ? '#b794f6' : isolated ? '#ff554e' : '#35d9e6'} /></mesh>
  </group>
}
