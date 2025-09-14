import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

export default function DrawTool({
  enabled,
  shape = "box",      // 'box' | 'cyl'
  height = 20,
  onCreate,
  controlsRef,        // 可選：用來暫停 OrbitControls
}) {
  useThree(); // 只需接 R3F 事件系統
  const overlayRef = useRef();
  const dragging = useRef(false);
  const start = useRef(new THREE.Vector3());
  const curr = useRef(new THREE.Vector3());
  const [tick, setTick] = useState(0);

  // 數學平面：y=0
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  // 繪圖時停用 OrbitControls
  useEffect(() => {
    if (!controlsRef?.current) return;
    controlsRef.current.enabled = !(enabled && dragging.current);
  }, [enabled, tick, controlsRef]);

  // 讓 overlay 一定能被 Raycast（忽略遮擋）
  useEffect(() => {
    const m = overlayRef.current;
    if (!m) return;
    m.raycast = (raycaster, intersects) => {
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(ground, p)) {
        intersects.push({
          distance: raycaster.ray.origin.distanceTo(p),
          point: p.clone(),
          object: m,
        });
      }
    };
  }, [ground]);

  const onPointerDown = (e) => {
    if (!enabled) return;
    e.stopPropagation();
    dragging.current = true;
    start.current.copy(e.point);
    curr.current.copy(e.point);
    setTick((x) => x + 1);
  };

  const onPointerMove = (e) => {
    if (!enabled || !dragging.current) return;
    e.stopPropagation();
    curr.current.copy(e.point);
    setTick((x) => x + 1);
  };

  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setTick((x) => x + 1);

    const a = start.current, b = curr.current;
    const dx = b.x - a.x, dz = b.z - a.z;

    if (shape === "box") {
      const w = Math.max(Math.abs(dx), 1);
      const d = Math.max(Math.abs(dz), 1);
      const pos = [(a.x + b.x) / 2, height / 2, (a.z + b.z) / 2];
      onCreate?.({ type: "box", w, h: height, d, pos, op: "add" });
    } else if (shape === "cyl") {
      const r = Math.max(Math.hypot(dx, dz) / 2, 1);
      const pos = [b.x, height / 2, b.z];
      onCreate?.({ type: "cyl", r, h: height, pos, axis: "y", op: "add" });
    }
  };

  const onPointerUp = (e) => { e.stopPropagation(); finish(); };
  const onPointerMissed = () => finish();

  // 預覽
  const a = start.current, b = curr.current;
  const dx = b.x - a.x, dz = b.z - a.z;
  const previewBox = dragging.current && shape === "box"
    ? { w: Math.max(Math.abs(dx), 1), d: Math.max(Math.abs(dz), 1), x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
    : null;
  const previewCyl = dragging.current && shape === "cyl"
    ? { r: Math.max(Math.hypot(dx, dz) / 2, 1), x: b.x, z: b.z }
    : null;

  return (
    <group>
      {/* 全畫面透明覆蓋（永遠能點到 y=0 平面） */}
      <mesh
        ref={overlayRef}
        position={[0, 0.001, 0]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerMissed={onPointerMissed}
        renderOrder={999}
      >
        <planeGeometry args={[10000, 10000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>

      {/* 預覽幾何 */}
      {previewBox && (
        <mesh position={[previewBox.x, height / 2, previewBox.z]}>
          <boxGeometry args={[previewBox.w, height, previewBox.d]} />
          <meshStandardMaterial color="#22c55e" transparent opacity={0.35} />
        </mesh>
      )}
      {previewCyl && (
        <mesh position={[previewCyl.x, height / 2, previewCyl.z]}>
          <cylinderGeometry args={[previewCyl.r, previewCyl.r, height, 32]} />
          <meshStandardMaterial color="#22c55e" transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}
