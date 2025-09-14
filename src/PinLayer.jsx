// src/PinLayer.jsx
import * as THREE from 'three'
import { useRef } from 'react'
import { useThree } from '@react-three/fiber'

export default function PinLayer({ pins, setPins }) {
  const { camera, gl, scene } = useThree()
  const ray = useRef(new THREE.Raycaster())
  const pointer = useRef(new THREE.Vector2())

  function onClick(e) {
    const rect = gl.domElement.getBoundingClientRect()
    pointer.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    ray.current.setFromCamera(pointer.current, camera)
    const hits = ray.current.intersectObjects(scene.children, true)
    const hit = hits.find(h => h.object.isMesh && !h.object.userData?.isPin)
    if (hit) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`
      setPins(prev => [...prev, { id, pos: hit.point.toArray(), note: '' }])
    }
  }

  return (
    <group onClick={onClick}>
      {pins.map(p => (
        <mesh key={p.id} position={p.pos} userData={{ isPin: true }}>
          <sphereGeometry args={[2.2, 16, 16]} />
          <meshStandardMaterial color="#ff4da6" emissive="#331122" />
        </mesh>
      ))}
    </group>
  )
}
