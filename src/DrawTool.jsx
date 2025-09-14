// src/DrawTool.jsx
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";

function useGroundIntersection() {
  const { camera, size, viewport, gl } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const ray = useMemo(() => new THREE.Ray(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  function screenToGround(clientX, clientY) {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    origin.setFromMatrixPosition(camera.matrixWorld);
    direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
    ray.set(origin, direction);

    const p = new THREE.Vector3();
    const hit = ray.intersectPlane(plane, p);
    return hit ? p.clone() : null;
  }

  return screenToGround;
}

function snap(v, step) {
  if (!step || step <= 0) return v;
  return Math.round(v / step) * step;
}

export default function DrawTool({
  enabled = false,
  height = 20,
  snapStep = 5,
  onDrawingChange,
  onCreateDSL, // (dslLine) => void
}) {
  const { gl } = useThree();
  const screenToGround = useGroundIntersection();

  const [drawing, setDrawing] = useState(false);
  const startRef = useRef(null);
  const curRef = useRef(null);

  const previewRef = useRef(); // 透明預覽方塊

  useEffect(() => {
    onDrawingChange?.(enabled && drawing);
  }, [enabled, drawing, onDrawingChange]);

  useEffect(() => {
    if (!enabled) {
      setDrawing(false);
      startRef.current = null;
      curRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    const el = gl.domElement;
    if (!enabled) return;

    function onDown(e) {
      // 右鍵或中鍵不畫
      if (e.button !== 0) return;
      const p = screenToGround(e.clientX, e.clientY);
      if (!p) return;
      startRef.current = new THREE.Vector3(snap(p.x, snapStep), 0, snap(p.z, snapStep));
      curRef.current = startRef.current.clone();
      setDrawing(true);
      e.preventDefault();
    }

    function onMove(e) {
      if (!drawing) return;
      const p = screenToGround(e.clientX, e.clientY);
      if (!p) return;
      curRef.current = new THREE.Vector3(snap(p.x, snapStep), 0, snap(p.z, snapStep));
      e.preventDefault();
    }

    function onUp(e) {
      if (!drawing) return;
      const a = startRef.current;
      const b = curRef.current || a;
      const w = Math.abs(b.x - a.x);
      const d = Math.abs(b.z - a.z);
      if (w > 0.1 && d > 0.1) {
        const cx = (a.x + b.x) / 2;
        const cz = (a.z + b.z) / 2;
        const h = Math.max(0.1, height);
        const line = `box w=${w.toFixed(2)} h=${h.toFixed(2)} d=${d.toFixed(2)} at(${cx.toFixed(2)},0,${cz.toFixed(2)})`;
        onCreateDSL?.(line);
      }
      setDrawing(false);
      startRef.current = null;
      curRef.current = null;
      e.preventDefault();
    }

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [enabled, drawing, gl, screenToGround, height, snapStep, onCreateDSL]);

  // 更新預覽方塊
  useEffect(() => {
    if (!previewRef.current) return;
    const mesh = previewRef.current;
    if (!drawing || !startRef.current || !curRef.current) {
      mesh.visible = false;
      return;
    }
    const a = startRef.current;
    const b = curRef.current;
    const w = Math.max(0.001, Math.abs(b.x - a.x));
    const d = Math.max(0.001, Math.abs(b.z - a.z));
    const h = Math.max(0.001, height);

    // 幾何重建
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(w, h, d);
    mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    mesh.visible = true;
  }, [drawing, height]);

  return (
    <>
      {/* 預覽方塊（半透明），只在 drawing 時可見 */}
      <mesh ref={previewRef} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6EE7B7" transparent opacity={0.45} depthWrite={false} />
      </mesh>
    </>
  );
}
