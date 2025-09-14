// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import SceneFromParams from "./SceneFromParams";
import { parseDSL } from "./dsl";
import PinLayer from "./PinLayer";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { naturalToDSL, looksLikeDSL } from "./nl";

const SAMPLE = `放一個底座 120x30x80 在中心；
沿Y的圓柱 半徑12 高40 在(20,15,0) 用來挖洞；
打個直徑10的貫穿孔 在(0,0,0)；`;

/* ------- 工具：穩定截圖 ------- */
function ScreenshotTaker({ request, onDone }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (!request) return;
    const raf = requestAnimationFrame(() => {
      try {
        gl.render(scene, camera);
        gl.domElement.toBlob(
          (blob) => {
            if (!blob) return onDone?.();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `snapshot-${Date.now()}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            onDone?.();
          },
          "image/png",
          1
        );
      } catch {
        const url = gl.domElement.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = `snapshot-${Date.now()}.png`;
        a.click();
        onDone?.();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [request, gl, scene, camera, onDone]);
  return null;
}

/* ------- 匯出共用 ------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function prepareExportRoot(root) {
  const clone = root.clone(true);
  clone.updateWorldMatrix?.(true, true);
  clone.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      let g = obj.geometry.isBufferGeometry
        ? obj.geometry
        : new THREE.BufferGeometry().fromGeometry(obj.geometry);
      g = g.clone();
      g.applyMatrix4(obj.matrixWorld);
      obj.matrixWorld.identity();
      obj.matrix.identity();
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(1, 1, 1);
      if (!g.attributes.normal) g.computeVertexNormals();
      obj.geometry = g;
      obj.material = new THREE.MeshStandardMaterial({
        color:
          (obj.material && obj.material.color && obj.material.color.getHex()) ||
          0x8fb3ff,
        metalness: 0.05,
        roughness: 0.8,
        side: THREE.FrontSide,
      });
    }
  });
  return clone;
}

/* ------- 新：對「匯出根」做精準置中與縮放 ------- */
function FitCameraToExportRoot({ resetKey, targetRef, padding = 1.3 }) {
  const { camera, controls, size } = useThree();
  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;

    // 用包圍盒估算大小與中心
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x) || !isFinite(box.max.x) || box.isEmpty()) return;

    const center = new THREE.Vector3();
    const sizeV = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(sizeV);

    const maxSize = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;

    // 依視角與長寬比求安全距離
    const fov = (camera.fov * Math.PI) / 180;
    const heightDist = (maxSize / 2) / Math.tan(fov / 2);
    const widthDist = (heightDist / (size.height > 0 ? size.height : 1)) * (size.width || 1);
    const distance = Math.max(heightDist, widthDist) * padding;

    // 讓相機沿對角線看向中心
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    const newPos = center.clone().add(dir.multiplyScalar(distance));

    camera.position.copy(newPos);
    camera.near = Math.max(0.01, distance / 1000);
    camera.far = Math.max(camera.far, distance * 1000);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [resetKey, targetRef, camera, controls, size.width, size.height, padding]);

  return null;
}

export default function App() {
  const [src, setSrc] = useState(() => localStorage.getItem("dsl") || SAMPLE);
  const [cmds, setCmds] = useState(() => parseDSL(naturalToDSL(SAMPLE)));
  const [lastDSL, setLastDSL] = useState(() => naturalToDSL(SAMPLE));
  const [pins, setPins] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pins") || "[]");
    } catch {
      return [];
    }
  });
  const [resetAsk, setResetAsk] = useState(0);
  const [shotAsk, setShotAsk] = useState(0);
  const exportRootRef = useRef();

  useEffect(() => {
    localStorage.setItem("dsl", src);
  }, [src]);
  useEffect(() => {
    localStorage.setItem("pins", JSON.stringify(pins));
  }, [pins]);

  const fitKey = useMemo(
    () => JSON.stringify({ k: resetAsk, cmdsLen: (cmds || []).length }),
    [resetAsk, cmds]
  );

  // ====== 匯出（GLB / STL）======
  function exportGLB() {
    const root = exportRootRef.current;
    if (!root) return alert("沒有可匯出的幾何，請先按「生成 3D」。");
    const safe = prepareExportRoot(root);
    const exporter = new GLTFExporter();
    exporter.parse(
      safe,
      (res) => {
        if (res instanceof ArrayBuffer) {
          downloadBlob(new Blob([res], { type: "model/gltf-binary" }), `model-${Date.now()}.glb`);
          return;
        }
        if (ArrayBuffer.isView(res)) {
          const view = res;
          const bytes = new Uint8Array(view.buffer, view.byteOffset || 0, view.byteLength);
          downloadBlob(new Blob([bytes], { type: "model/gltf-binary" }), `model-${Date.now()}.glb`);
          return;
        }
        if (typeof res === "object") {
          const json = JSON.stringify(res, null, 2);
          downloadBlob(new Blob([json], { type: "model/gltf+json" }), `model-${Date.now()}.gltf`);
          alert("已匯出為 glTF（.gltf）。大多數 viewer/Blender 都可直接開啟。");
          return;
        }
        alert("匯出失敗：未知輸出格式");
      },
      { binary: true, onlyVisible: true, truncateDrawRange: true, embedImages: true }
    );
  }
  function exportSTL() {
    const root = exportRootRef.current;
    if (!root) return alert("沒有可匯出的幾何，請先按「生成 3D」。");
    const safe = prepareExportRoot(root);
    const exporter = new STLExporter();
    const stlText = exporter.parse(safe, { binary: false });
    downloadBlob(new Blob([stlText], { type: "model/stl" }), `model-${Date.now()}.stl`);
  }

  // ====== 生成 3D：自然語言 → DSL → commands ======
  function build() {
    const maybeDSL = looksLikeDSL(src) ? src : naturalToDSL(src);
    setLastDSL(maybeDSL);
    setCmds(parseDSL(maybeDSL));
    setResetAsk((x) => x + 1); // 生成後也重置視角
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", height: "100vh" }}>
      {/* 左側面板 */}
      <div
        style={{
          padding: 12,
          borderRight: "1px solid #222",
          background: "#0e1116",
          color: "#ddd",
          overflow: "auto",
        }}
      >
        <h3 style={{ margin: "0 0 8px" }}>用中文描述你的 3D</h3>
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          placeholder={
            "例：\n放一個底座 120x30x80 在(0,0,0)；\n沿Y的圓柱 半徑12 高40 在(20,15,0) 用來挖洞；\n打個直徑10的貫穿孔 在(0,0,0)；"
          }
          style={{ width: "100%", height: 200, background: "#0b0e13", color: "#ddd" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 12px" }}>
          <button onClick={build}>生成 3D</button>
          <button onClick={() => setResetAsk((x) => x + 1)}>重置視角</button>
          <button onClick={() => setShotAsk((x) => x + 1)}>截圖 PNG</button>
          <button onClick={exportGLB}>Export GLB/GLTF</button>
          <button onClick={exportSTL}>Export STL</button>
        </div>

        {/* 解析後 DSL（唯讀） */}
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          <div style={{ margin: "6px 0 4px", color: "#9ca3af" }}>解析後 DSL：</div>
          <textarea
            readOnly
            value={lastDSL}
            style={{ width: "100%", height: 120, background: "#0b0e13", color: "#9ca3af" }}
          />
        </div>

        {/* Pins */}
        <h4 style={{ margin: "12px 0 8px" }}>Pins（點模型可插針）</h4>
        {pins.length === 0 && <div style={{ opacity: 0.7 }}>點 3D 模型來新增 Pin</div>}
        {pins.map((p) => (
          <div
            key={p.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <input
              value={p.note}
              placeholder={`備註（${p.pos.map((n) => n.toFixed(1)).join(", ")})`}
              onChange={(e) =>
                setPins((arr) => arr.map((x) => (x.id === p.id ? { ...x, note: e.target.value } : x)))
              }
              style={{
                background: "#0b0e13",
                color: "#ddd",
                border: "1px solid #333",
                padding: "6px 8px",
                borderRadius: 6,
              }}
            />
            <button onClick={() => setPins((arr) => arr.filter((x) => x.id !== p.id))}>刪除</button>
          </div>
        ))}
      </div>

      {/* 右側 3D 畫布 */}
      <Canvas
        camera={{ position: [150, 120, 150], fov: 45 }}
        style={{ background: "#0e1116" }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#0e1116"]} />

        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 80, 50]} intensity={0.85} />
        <Grid args={[500, 50]} sectionColor="#4b5563" cellColor="#374151" />

        {/* 真正要 fit 的只有這個匯出根 */}
        <SceneFromParams commands={cmds} exportRef={exportRootRef} />

        {/* Pins 不影響重置視角 */}
        <PinLayer pins={pins} setPins={setPins} />

        {/* 這個元件會根據 resetAsk / cmds 自動把相機對準 exportRoot */}
        <FitCameraToExportRoot resetKey={fitKey} targetRef={exportRootRef} />

        <ScreenshotTaker request={shotAsk} onDone={() => {}} />
        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
