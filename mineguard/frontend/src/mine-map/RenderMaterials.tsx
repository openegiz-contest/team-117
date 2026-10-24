import { useContext } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { SoftwareRenderer } from './renderQuality'

/** Vertex-lit materials keep the same geometry/data on CPU WebGL renderers. */
export function MineMaterial(props: ThreeElements['meshStandardMaterial']) {
  const software = useContext(SoftwareRenderer)
  if (!software) return <meshStandardMaterial {...props} />
  const { color, emissive, emissiveIntensity, flatShading, side, transparent,
    opacity, toneMapped, depthWrite } = props
  return <meshLambertMaterial color={color} emissive={emissive}
    emissiveIntensity={emissiveIntensity} flatShading={flatShading} side={side}
    transparent={transparent} opacity={opacity} toneMapped={toneMapped} depthWrite={depthWrite} />
}
