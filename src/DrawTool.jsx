import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

/**
 * DrawTool
 * - enabled: 是否啟用
 * - shape: 'box' | 'cyl' | 'hole'
 * - op: 'add' | 'sub'   （hole 不用）
 * - height: 物體高度（mm）
 * - holeDia: 孔徑（mm）
 * - snapStep: 吸附間距（mm；0/1 = 不吸附）
 * - onCreate(cmd): 回傳一筆 DSL 指令物件
 */
export default function DrawTool({
  enabled = false,
  shape = "box",
  op = "add",
  height = 20,
  holeDia = 8,
  snapStep = 5,
  onCreate,
}) {
  const { gl, camera, scene, size } = useThree();
  const draggingRef = useRef(false);
  const startRef = useRef(new THREE.Vector3());
  const previewRef = useRef(null);
  const raycaster = useRef(new THREE.Raycaster());
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)); // y=0 平面
  const tmpVec = useRef(new THREE.Vector3());

  const snap = (v) => {
    if (!snapStep || snapStep <= 1) return v;
    return Math.round(v / snapStep) * snapStep;
    // 註：若要 0 表示不吸附，把條件改成 <=0
  };

  const ndcFromEvent = (e) => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return { x, y };
  };

  const intersectOnPlane = (e) => {
    const { x, y } = ndcFromEvent(e);
    raycaster.current.setFromCamera({ x, y }, camera);
    const point = new THREE.Vector3();
    raycaster.current.ray.intersectPlane(plane.current, point);
    return point;
  };

  const ensurePreview = () => {
    if (previewRef.current) return previewRef.current;
    const g = new THREE.MeshStandardMaterial({
      color: shape === "cyl" ? "#ffe08a" : "#8fd3ff",
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    let mesh;
    if (shape === "cyl" || shape === "hole") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48), g);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), g);
    }
    mesh.visible = false;
    scene.add(mesh);
    previewRef.current = mesh;
    return mesh;
  };

  const clearPreview = () => {
    if (previewRef.current) {
      scene.remove(previewRef.current);
      previewRef.current.geometry.dispose();
      // material 可共用，不強制 dispose 以免誤刪
      previewRef.current = null;
    }
  };

  useEffect(() => {
    if (!enabled) {
      draggingRef.current = false;
      clearPreview();
      return;
    }

    const onDown = (e) => {
      if (!enabled) return;
      e.preventDefault();

      // hole：單點放置
      if (shape === "hole") {
        const p = intersectOnPlane(e);
        if (!isFinite(p.x) || !isFinite(p.z)) return;
        const x = snap(p.x);
        const z = snap(p.z);
        onCreate?.({
          type: "hole",
          dia: holeDia,
          pos: [x, 0, z],
          depth: "thru",
        });
        return;
      }

      // box / cyl：開始拖曳
      const p = intersectOnPlane(e);
      if (!isFinite(p.x) || !isFinite(p.z)) return;
      draggingRef.current = true;
      startRef.current.set(snap(p.x), 0, snap(p.z));

      const mesh = ensurePreview();
      mesh.visible = true;
      if (shape === "cyl") {
        mesh.scale.set(1, 1, 1);
        mesh.position.set(startRef.current.x, height / 2, startRef.current.z);
      } else {
        mesh.scale.set(1, 1, 1);
        mesh.position.set(startRef.current.x, height / 2, startRef.current.z);
      }
    };

    const onMove = (e) => {
      if (!enabled) return;
      if (!draggingRef.current) return;

      const cur = intersectOnPlane(e);
      if (!isFinite(cur.x) || !isFinite(cur.z)) return;

      const sx = startRef.current.x;
      const sz = startRef.current.z;
      const ex = snap(cur.x);
      const ez = snap(cur.z);

      const mesh = ensurePreview();
      mesh.visible = true;

      if (shape === "cyl") {
        const r = Math.max(1, Math.hypot(ex - sx, ez - sz));
        mesh.geometry.dispose();
        mesh.geometry = new THREE.CylinderGeometry(r, r, Math.max(1, height), 48);
        mesh.position.set(sx, height / 2, sz);
      } else {
        const w = Math.max(1, Math.abs(ex - sx));
        const d = Math.max(1, Math.abs(ez - sz));
        const cx = (sx + ex) / 2;
        const cz = (sz + ez) / 2;

        mesh.geometry.dispose();
        mesh.geometry = new THREE.BoxGeometry(w, Math.max(1, height), d);
        mesh.position.set(cx, height / 2, cz);
      }
    };

    const onUp = (e) => {
      if (!enabled) return;

      if (!draggingRef.current) return;
      draggingRef.current = false;

      const cur = intersectOnPlane(e);
      if (!isFinite(cur.x) || !isFinite(cur.z)) {
        clearPreview();
        return;
      }

      const sx = startRef.current.x;
      const sz = startRef.current.z;
      const ex = snap(cur.x);
      const ez = snap(cur.z);

      if (shape === "cyl") {
        const r = Math.max(1, Math.hypot(ex - sx, ez - sz));
        onCreate?.({
          type: "cyl",
          r,
          h: Math.max(1, height),
          pos: [sx, Math.max(1, height) / 2, sz],
          axis: "y",
          op,
        });
      } else {
        const w = Math.max(1, Math.abs(ex - sx));
        const d = Math.max(1, Math.abs(ez - sz));
        const cx = (sx + ex) / 2;
        const cz = (sz + ez) / 2;
        onCreate?.({
          type: "box",
          w,
          h: Math.max(1, height),
          d,
          pos: [cx, Math.max(1, height) / 2, cz],
          op,
        });
      }

      clearPreview();
    };

    const dom = gl.domElement;
    dom.addEventListener("pointerdown", onDown, { passive: false });
    dom.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { passive: false });

    return () => {
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearPreview();
    };
  }, [enabled, shape, op, height, holeDia, snapStep, gl, camera, scene, size, onCreate]);

  return null; // 純行為元件（不渲染 React 內容，預覽用 three 物件）
}
