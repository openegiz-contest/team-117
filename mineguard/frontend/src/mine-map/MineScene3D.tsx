import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { IndustrialCutaway } from './IndustrialCutaway'
import { MiningEquipment, TunnelInfrastructure } from './MineStructures'
import { MineMaterial } from './RenderMaterials'
import { SoftwareRenderer } from './renderQuality'

import type { RiskState } from '../api/contracts'
import type { MineSceneModel, SceneAirway, SceneFan, SceneZone } from './sceneModel'
import { RISK_COLOURS } from './sceneModel'

export type CameraPreset = 'overview' | 'top' | 'airflow' | 'focus'
export interface SceneLayers { airflow: boolean; gas: boolean; sensors: boolean; structure: boolean }

function TunnelSegment({ airway, reducedMotion, showAirflow, showStructure }: { airway: SceneAirway; reducedMotion: boolean; showAirflow: boolean; showStructure: boolean }) {
  const { midpoint, length, quaternion } = useMemo(() => {
    const source = new THREE.Vector3(...airway.source)
    const target = new THREE.Vector3(...airway.target)
    const direction = target.clone().sub(source)
    return {
      midpoint: source.clone().add(target).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize()),
    }
  }, [airway.source, airway.target])
  return (
    <group position={midpoint} quaternion={quaternion}>
      <mesh position={[0, -0.7, 0]} receiveShadow>
        <boxGeometry args={[length, 0.18, 3.5]} />
        <MineMaterial color="#33464f" roughness={0.88} metalness={0.16} />
      </mesh>
      {showStructure && [-1.72, 1.72].map((z) => (
        <mesh key={z} position={[0, -0.48, z]} receiveShadow>
          <boxGeometry args={[length, 0.4, 0.2]} />
          <MineMaterial color="#40545d" roughness={0.78} metalness={0.28} />
        </mesh>
      ))}
      {showStructure && <mesh position={[0, 1.65, -1.45]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.09, 0.09, length, 10]} />
        <MineMaterial color="#d49a43" metalness={0.72} roughness={0.33} />
      </mesh>}
      {showAirflow && <AirflowStream airway={airway} length={length} reducedMotion={reducedMotion} />}
      {showStructure && <TunnelInfrastructure length={length} />}
    </group>
  )
}

function AirflowStream({ airway, length, reducedMotion }: { airway: SceneAirway; length: number; reducedMotion: boolean }) {
  const particles = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const count = 18
  useFrame(({ clock }) => {
    if (!particles.current) return
    const speed = Math.min(0.45, Math.max(0, airway.flowM3s / 85))
    const elapsed = reducedMotion ? 0 : clock.elapsedTime
    for (let index = 0; index < count; index += 1) {
      const progress = (index / count + elapsed * speed) % 1
      dummy.position.set((progress - 0.5) * length, 0.15 + Math.sin(index * 1.7) * 0.32, Math.cos(index * 2.13) * 0.65)
      const pulse = reducedMotion || speed === 0 ? 0.55 : 0.55 + Math.sin(elapsed * 4 + index) * 0.18
      dummy.scale.setScalar(pulse)
      dummy.updateMatrix()
      particles.current.setMatrixAt(index, dummy.matrix)
    }
    particles.current.instanceMatrix.needsUpdate = true
  })
  return (
    <group>
      <instancedMesh ref={particles} args={[undefined, undefined, count]}>
        <sphereGeometry args={[0.105, 7, 7]} />
        <meshBasicMaterial color="#35d9e6" transparent opacity={airway.flowM3s > 0 ? 0.95 : 0.18} toneMapped={false} />
      </instancedMesh>
      {[-0.32, 0, 0.32].map((ratio) => <mesh key={ratio} position={[length * ratio, 0.18, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.22, 0.58, 8]} /><meshBasicMaterial color="#35d9e6" transparent opacity={0.9} toneMapped={false} />
      </mesh>)}
    </group>
  )
}

function stableSeed(value: string): number {
  let seed = 37
  for (const character of value) seed = (seed * 31 + character.charCodeAt(0)) % 2_147_483_647
  return Math.max(1, seed)
}

function GasCloud({ zoneId, methanePercent, risk, reducedMotion }: { zoneId: string; methanePercent: number; risk: RiskState; reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null)
  const geometry = useRef<THREE.BufferGeometry>(null)
  const positions = useMemo(() => {
    const output = new Float32Array(120 * 3)
    let seed = stableSeed(zoneId)
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647
      return (seed - 1) / 2_147_483_646
    }
    for (let index = 0; index < 120; index += 1) {
      const radius = 0.25 + random() * 1.7
      const angle = random() * Math.PI * 2
      output[index * 3] = Math.cos(angle) * radius
      output[index * 3 + 1] = random() * 2.2 - 0.2
      output[index * 3 + 2] = Math.sin(angle) * radius
    }
    return output
  }, [zoneId])
  const visibleCount = Math.round(8 + Math.min(1, Math.max(0, methanePercent / 2.5)) * 112)
  useEffect(() => geometry.current?.setDrawRange(0, visibleCount), [visibleCount])
  useFrame(({ clock }) => {
    if (!points.current) return
    const elapsed = reducedMotion ? 0 : clock.elapsedTime
    points.current.rotation.y = elapsed * 0.07
    points.current.position.y = Math.sin(elapsed * 0.45) * 0.08
  })
  const opacity = Math.min(0.82, 0.12 + methanePercent / 2.2)
  return (
    <group><points ref={points}>
      <bufferGeometry ref={geometry}><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial color={RISK_COLOURS[risk]} size={0.09} transparent opacity={opacity} depthWrite={false} sizeAttenuation />
    </points>
    {risk !== 'NORMAL' && risk !== 'UNKNOWN_DATA' && [0, 1, 2].map((i) => <mesh key={i} position={[(i - 1) * 0.5, 0.6 + i * 0.2, 0]} scale={[1.4, 0.65, 1.2]}>
      <sphereGeometry args={[1, 12, 8]} /><meshBasicMaterial color={RISK_COLOURS[risk]} transparent opacity={Math.min(0.14, methanePercent * 0.05)} depthWrite={false} />
    </mesh>)}</group>
  )
}

function HazardBeacon({ risk, reducedMotion }: { risk: RiskState; reducedMotion: boolean }) {
  const beacon = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!beacon.current) return
    const pulse = reducedMotion ? (risk === 'EMERGENCY' ? 1.4 : risk === 'WARNING' ? 1.1 : 0.55) : risk === 'EMERGENCY'
      ? 1.4 + Math.sin(clock.elapsedTime * 9) * 1.1
      : risk === 'WARNING' ? 1.1 + Math.sin(clock.elapsedTime * 4) * 0.55 : 0.55
    beacon.current.scale.setScalar(0.8 + Math.max(0.2, pulse) * 0.3)
  })
  return (
    <group position={[0, 2.2, 0]}>
      <mesh ref={beacon}><sphereGeometry args={[0.17, 8, 8]} /><meshBasicMaterial color={RISK_COLOURS[risk]} toneMapped={false} /></mesh>
    </group>
  )
}

function ZoneChamber({ zone, selected, onSelect, reducedMotion, showGas, showSensors }: { zone: SceneZone; selected: boolean; onSelect: (id: string) => void; reducedMotion: boolean; showGas: boolean; showSensors: boolean }) {
  const colour = RISK_COLOURS[zone.risk]
  return (
    <group position={zone.position} onClick={(event) => { event.stopPropagation(); onSelect(zone.id) }}>
      <mesh receiveShadow castShadow position={[0, -0.55, 0]}>
        <cylinderGeometry args={[2.15, 2.15, 0.28, 32]} />
        <MineMaterial color={selected ? '#52646c' : '#344750'} roughness={0.8} metalness={0.22} emissive={selected ? '#173039' : '#000000'} emissiveIntensity={selected ? 0.35 : 0} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.36, 0]}>
        <torusGeometry args={[1.75, selected ? 0.12 : 0.07, 8, 48]} />
        <meshBasicMaterial color={selected ? '#ffffff' : colour} toneMapped={false} />
      </mesh>
      {(zone.role === 'production' || zone.role === 'heading') && <MiningEquipment isolated={zone.isolated} unknown={zone.risk === 'UNKNOWN_DATA'} />}
      <HazardBeacon risk={zone.risk} reducedMotion={reducedMotion} />
      {showGas && <GasCloud zoneId={zone.id} methanePercent={zone.methanePercent} risk={zone.risk} reducedMotion={reducedMotion} />}
      <Html position={[0, 2.75, 0]} center occlude={false} zIndexRange={[4, 0]} style={{ display: showSensors ? 'block' : 'none' }}>
        <button className={`scene-label scene-label-${zone.risk.toLowerCase()} ${selected ? 'selected' : ''}`} aria-hidden={!showSensors} tabIndex={showSensors ? 0 : -1} onClick={() => onSelect(zone.id)}>
          <span>{zone.id} · {zone.role === 'production' ? 'ZONE 4B' : zone.role.toUpperCase()}</span><strong>{zone.methanePercent.toFixed(3)}% CH₄</strong><small>{zone.risk.replace('_', ' ')}</small>
        </button>
      </Html>
    </group>
  )
}

function VentilationFan({ fan, reducedMotion }: { fan: SceneFan; reducedMotion: boolean }) {
  const rotor = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (rotor.current && !fan.faulted && !reducedMotion) rotor.current.rotation.z -= delta * fan.speedFraction * 14
  })
  const colour = fan.faulted ? '#ff4545' : '#57e6ee'
  const main = fan.id === 'FAN_MAIN'
  return (
    <group position={fan.position} rotation={[0, Math.PI / 5, 0]} scale={main ? 2.25 : 1.35}>
      <mesh position={[0, 0, -0.35]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.92, 0.92, 0.78, 24, 1, true]} /><MineMaterial color="#8ca1a6" side={THREE.DoubleSide} roughness={0.38} metalness={0.68} /></mesh>
      <mesh position={[0, -1.02, -0.25]}><boxGeometry args={[2.25, 0.24, 1.55]} /><MineMaterial color="#667d83" /></mesh>
      <mesh><torusGeometry args={[0.78, 0.14, 12, 36]} /><MineMaterial color="#b0bdc0" metalness={0.86} roughness={0.2} /></mesh>
      <mesh position={[0, 0, -0.44]}><torusGeometry args={[0.88, 0.055, 8, 36]} /><meshBasicMaterial color={colour} toneMapped={false} /></mesh>
      <group ref={rotor}>
        {[0, 1, 2, 3, 4, 5].map((blade) => (
          <group key={blade} rotation={[0, 0, blade * Math.PI / 3]}>
            <mesh position={[0.37, 0, 0]}>
              <boxGeometry args={[0.58, 0.16, 0.08]} />
              <MineMaterial color={colour} emissive={colour} emissiveIntensity={0.18} metalness={0.6} roughness={0.35} />
            </mesh>
          </group>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.3, 16]} /><MineMaterial color="#d5e1e5" metalness={0.8} /></mesh>
      </group>
      {[-1, 1].map((side) => <mesh key={side} position={[side * 0.78, -0.36, -0.05]}><boxGeometry args={[0.1, 1.22, 0.12]} /><MineMaterial color="#a3b2b5" metalness={0.76} roughness={0.28} /></mesh>)}
      <Html position={[0, -1.05, 0]} center distanceFactor={12}><div className="fan-label"><strong>{fan.id}</strong><span>{fan.faulted ? 'FAULT · ' : ''}{fan.actualRpm.toFixed(0)} RPM · {Math.round(fan.speedFraction * 100)}% · {fan.powerKw.toFixed(1)} kW</span></div></Html>
    </group>
  )
}

function CameraReset({ signal, preset, selectedZone }: { signal: number; preset: CameraPreset; selectedZone?: SceneZone }) {
  const { camera, size } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  const moving = useRef(true)
  const destination = useRef(new THREE.Vector3(0, 13, 18))
  const focus = useRef(new THREE.Vector3(0, -0.8, 0))
  const [x, y, z] = preset === 'focus' && selectedZone ? selectedZone.position : [0, -0.8, 0]
  useEffect(() => {
    focus.current.set(x, y, z)
    const positions: Record<Exclude<CameraPreset, 'focus'>, [number, number, number]> = {
      overview: [0, 14, 20], top: [0, 27, 0.1], airflow: [-22, 10, 20],
    }
    destination.current.copy(preset === 'focus' ? focus.current.clone().add(new THREE.Vector3(6, 7, 10)) : new THREE.Vector3(...positions[preset]))
    // Preserve the full network on narrow canvases; focus remains a deliberate close-up.
    if (preset !== 'focus') destination.current.sub(focus.current).multiplyScalar(Math.max(1, 1.9 / (size.width / size.height))).add(focus.current)
    moving.current = true
  }, [preset, signal, x, y, z, size.width, size.height])
  useFrame(({ gl }, delta) => {
    if (!controls.current) return
    if (moving.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const factor = reduced ? 1 : 1 - Math.exp(-delta * 5)
      camera.position.lerp(destination.current, factor)
      controls.current.target.lerp(focus.current, factor)
      controls.current.update()
      if (camera.position.distanceTo(destination.current) < 0.01) moving.current = false
    }
    // Non-sensitive diagnostics for reproducible software-WebGL measurements.
    gl.domElement.setAttribute('data-draw-calls', String(gl.info.render.calls))
    gl.domElement.setAttribute('data-triangles', String(gl.info.render.triangles))
    gl.domElement.setAttribute('data-camera', camera.position.toArray().map((v) => v.toFixed(3)).join(','))
  })
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={7} maxDistance={55} maxPolarAngle={Math.PI * 0.49} onStart={() => { moving.current = false }} />
}

function MineEnvironment({ model, selected, onSelect, reducedMotion, resetSignal, preset, layers }: { model: MineSceneModel; selected: string; onSelect: (id: string) => void; reducedMotion: boolean; resetSignal: number; preset: CameraPreset; layers: SceneLayers }) {
  const selectedZone = model.zones.find((zone) => zone.id === selected)
  return (
    <>
      <color attach="background" args={['#101b1e']} />
      <fog attach="fog" args={['#101b1e', 34, 68]} />
      <hemisphereLight intensity={1.55} color="#e0f4f4" groundColor="#35464a" />
      <ambientLight intensity={0.9} color="#b8d0d1" />
      <directionalLight position={[8, 18, 14]} intensity={2.65} color="#fff4df" />
      <directionalLight position={[-13, 9, -11]} intensity={0.95} color="#63d9e4" />
      <CameraReset signal={resetSignal} preset={preset} selectedZone={selectedZone} />
      <IndustrialCutaway model={model} visible={layers.structure} />
      {model.airways.map((airway) => <TunnelSegment key={airway.id} airway={airway} reducedMotion={reducedMotion} showAirflow={layers.airflow} showStructure={layers.structure} />)}
      {layers.airflow && model.airways.map((airway) => <Line key={`${airway.id}-route`} points={[airway.source, airway.target]} color="#35d9e6" lineWidth={1.25} transparent opacity={0.72} />)}
      {model.zones.map((zone) => <ZoneChamber key={zone.id} zone={zone} selected={selected === zone.id} onSelect={onSelect} reducedMotion={reducedMotion} showGas={layers.gas} showSensors={layers.sensors} />)}
      {model.fans.map((fan) => <VentilationFan key={fan.id} fan={fan} reducedMotion={reducedMotion} />)}
    </>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export default function MineScene3D({ model, selected, onSelect, resetSignal, preset, layers }: { model: MineSceneModel; selected: string; onSelect: (id: string) => void; resetSignal: number; preset: CameraPreset; layers: SceneLayers }) {
  const reducedMotion = usePrefersReducedMotion()
  const [pixelRatio, setPixelRatio] = useState(1)
  return (
    <Canvas camera={{ position: [0, 14, 20], fov: 45, near: 0.1, far: 150 }} dpr={pixelRatio} gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.25 }} onCreated={({ gl }) => {
      const context = gl.getContext()
      const debug = context.getExtension('WEBGL_debug_renderer_info')
      const renderer = String(debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER))
      const software = /swiftshader|llvmpipe|software|softpipe/i.test(renderer)
      setPixelRatio(software ? 0.65 : 1)
      gl.domElement.dataset.renderProfile = software ? 'software-0.65' : 'standard-1.0'
    }}>
      <SoftwareRenderer.Provider value={pixelRatio < 1}><Suspense fallback={null}><MineEnvironment model={model} selected={selected} onSelect={onSelect} reducedMotion={reducedMotion} resetSignal={resetSignal} preset={preset} layers={layers} /></Suspense></SoftwareRenderer.Provider>
    </Canvas>
  )
}
