// src/App.jsx
import { useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import SceneFromParams from "./SceneFromParams";
import { parseDSL } from "./dsl";
import { parseNL } from "./nl";
import PinLayer from "./PinLayer";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

const EXAMPLES = [
  {
    label: "板子 + 圓柱 + 貫穿孔",
    dsl: `box w=120 h=30 d=80;
cylinder r=12 h=40 at(20,15,0) axis=y;
hole dia=10 at(0,0,0) depth=thru;`,
  },
  {
    label: "長方體 + 兩個孔",
    dsl: `box w=100 h=20 d=60;
hole dia=8 at(-20,10,0);
hole dia=8 at(20,10,0);`,
  },
  {
    label: "小平台 + 直立圓柱",
    dsl: `box w=80 h=10 d=80;
cylinder r=10 h=50 at(0,0,5) axis=z;`,
  },
];

const SAMPLE = EXAMPLES[0].dsl;

/* ---------- 截圖 ---------- */
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

/* ---------- 匯出：下載工具 ---------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- 匯出：烘入世界變換/補法線/固定材質 ---------- */
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

/* ---------- GLTFExporter 簽名兼容 ---------- */
function parseGLTF(exporter, input, onDone, options) {
  const len = exporter.parse.length;
  if (len >= 4) exporter.parse(input, onDone, (e) => console.error(e), options);
  else exporter.parse(input, onDone, options);
}

/* ---------- 置中到模型並可記錄當下相機姿態 ---------- */
function fitToExportRoot({ root, camera, controls, recordPoseRef, record = false }) {
  if (!root) return;

  // 容錯：多試幾次直到有包圍盒
  let tries = 0;
  const tick = () => {
    tries++;
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x) || box.isEmpty()) {
      if (tries < 20) return requestAnimationFrame(tick);
      return;
    }

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone();
    const radius = Math.max(sphere.radius, 1e-3);

    const fov = (camera.fov * Math.PI) / 180;
    const fitH = radius / Math.sin(fov / 2);
    const fitW = fitH / camera.aspect;
    const distance = Math.max(fitH, fitW) * 1.25;

    const curTarget = controls?.target || new THREE.Vector3(0, 0, 0);
    const dir = camera.position.clone().sub(curTarget).normalize();
    if (dir.lengthSq() === 0) dir.set(1, 1, 1).normalize();

    const nextPos = center.clone().add(dir.multiplyScalar(distance));

    camera.position.copy(nextPos);
    camera.near = Math.max(distance / 100, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }

    if (record && recordPoseRef) {
      recordPoseRef.current = {
        pos: nextPos.clone(),
        target: center.clone(),
        near: camera.near,
        far: camera.far,
        fov: camera.fov,
      };
    }
  };
  requestAnimationFrame(tick);
}

/* ---------- 讓外部能呼叫 FIT / RESTORE，相機在 Canvas 內取得 ---------- */
function FitOnceHelper({ exportRootRef, controlsRef, initialPoseRef }) {
  const { camera, scene } = useThree();
  useEffect(() => {
    const onFitOnce = (e) => {
      const record = !!(e.detail && e.detail.record);
      const root = exportRootRef.current || scene.getObjectByName("EXPORT_ROOT");
      fitToExportRoot({
        root,
        camera,
        controls: controlsRef.current,
        recordPoseRef: initialPoseRef,
        record,
      });
    };
    const onRestore = (e) => {
      const pose = e.detail?.pose;
      if (!pose) return;
      camera.position.copy(pose.pos);
      camera.near = pose.near ?? camera.near;
      camera.far = pose.far ?? camera.far;
      camera.fov = pose.fov ?? camera.fov;
      camera.updateProjectionMatrix();
      if (controlsRef.current) {
        controlsRef.current.target.copy(pose.target);
        controlsRef.current.update();
      }
    };
    window.addEventListener("FIT_ONCE", onFitOnce);
    window.addEventListener("RESTORE_POSE", onRestore);
    return () => {
      window.removeEventListener("FIT_ONCE", onFitOnce);
      window.removeEventListener("RESTORE_POSE", onRestore);
    };
  }, [camera, scene, exportRootRef, controlsRef, initialPoseRef]);
  return null;
}

export default function App() {
  const [src, setSrc] = useState(() => localStorage.getItem("dsl") || SAMPLE);
  const [cmds, setCmds] = useState(() => parseDSL(localStorage.getItem("dsl") || SAMPLE));
  const [nl, setNL] = useState("");
  const [pins, setPins] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pins") || "[]");
    } catch {
      return [];
    }
  });
  const [shotAsk, setShotAsk] = useState(0);

  // 幾何根 / 控制器 / 「生成當下的相機姿態」
  const exportRootRef = useRef();
  const controlsRef = useRef();
  const initialPoseRef = useRef(null);

  // 分享連結參數（可載入 DSL + pins）
  useEffect(() => {
    const u = new URL(window.location.href);
    const s = u.searchParams.get("s");
    if (s) {
      try {
        const txt = decodeURIComponent(escape(atob(s)));
        const p = JSON.parse(txt);
        if (p?.dsl) {
          setSrc(p.dsl);
          setCmds(parseDSL(p.dsl));
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: true } }));
          });
        }
        if (Array.isArray(p?.pins)) localStorage.setItem("pins", JSON.stringify(p.pins));
      } catch {}
      u.searchParams.delete("s");
      window.history.replaceState({}, "", u.pathname);
    }
  }, []);

  useEffect(() => localStorage.setItem("dsl", src), [src]);
  useEffect(() => localStorage.setItem("pins", JSON.stringify(pins)), [pins]);

  /* ---------- 生成 3D ---------- */
  const handleGenerate = (dslText) => {
    const text = dslText ?? src;
    setSrc(text);            // 同步到下方 DSL 欄
    setCmds(parseDSL(text)); // 更新指令
    // 等一幀 → 嘗試 fit，並「記錄」這個生成當下的相機姿態
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: true } }));
    });
  };

  /* ---------- 重設視角：回到生成當下 ---------- */
  const handleResetView = () => {
    const pose = initialPoseRef.current;
    if (!pose) {
      window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: true } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("RESTORE_POSE", { detail: { pose } }));
  };

  /* ---------- 匯出 ---------- */
  function exportGLB() {
    const root = exportRootRef.current;
    if (!root) return alert("沒有可匯出的幾何，請先按「生成 3D」。");
    const safe = prepareExportRoot(root);
    const exporter = new GLTFExporter();
    const opts = { binary: true, onlyVisible: true, truncateDrawRange: true, embedImages: true };

    parseGLTF(
      exporter,
      safe,
      (res) => {
        let ab = null;
        if (res instanceof ArrayBuffer) ab = res;
        else if (res && res.buffer instanceof ArrayBuffer) ab = res.buffer;

        // 若不是有效 GLB，改輸出 glTF JSON 備援
        if (ab) {
          try {
            const u8 = new Uint8Array(ab, 0, 4);
            const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
            if (magic === "glTF") {
              const blob = new Blob([ab], { type: "model/gltf-binary" });
              downloadBlob(blob, `model-${Date.now()}.glb`);
              return;
            }
          } catch {}
        }
        const exporter2 = new GLTFExporter();
        parseGLTF(
          exporter2,
          safe,
          (json) => {
            const blob = new Blob([JSON.stringify(json)], { type: "application/json" });
            downloadBlob(blob, `model-${Date.now()}.gltf`);
          },
          { binary: false }
        );
      },
      opts
    );
  }

  function exportSTL() {
    const root = exportRootRef.current;
    if (!root) return alert("沒有可匯出的幾何，請先按「生成 3D」。");
    const safe = prepareExportRoot(root);
    const exporter = new STLExporter();
    const stlText = exporter.parse(safe, { binary: false });
    const blob = new Blob([stlText], { type: "model/stl" });
    downloadBlob(blob, `model-${Date.now()}.stl`);
  }

  async function shareLink() {
    const payload = { dsl: src, pins };
    const s = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const url = `${location.origin}${location.pathname}?s=${s}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("已複製分享連結到剪貼簿！");
    } catch {
      prompt("複製這個分享連結：", url);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", height: "100vh" }}>
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
          value={nl}
          onChange={(e) => setNL(e.target.value)}
          placeholder={`例：\n做一塊板子 寬120 長80 厚30；在(0,0)開一個直徑10的貫穿孔；\n放一個圓柱 半徑12 高40 在(20,15,0) 沿著Y軸。`}
          style={{ width: "100%", height: 90, background: "#0b0e13", color: "#ddd", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              const dsl = parseNL(nl);
              if (!dsl) return alert("抱歉，這段中文我看不懂，再換個說法試試 🙏");
              handleGenerate(dsl); // 直接以這段 DSL 生成（並同步到下方 DSL 欄位）
            }}
          >
            中文 → 生成
          </button>

          <select
            onChange={(e) => {
              const found = EXAMPLES.find((x) => x.dsl === e.target.value);
              if (found) handleGenerate(found.dsl);
            }}
            defaultValue=""
            style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
          >
            <option value="" disabled>載入範例…</option>
            {EXAMPLES.map((ex) => (
              <option key={ex.label} value={ex.dsl}>
                {ex.label}
              </option>
            ))}
          </select>
        </div>

        <h3 style={{ margin: "12px 0 8px" }}>DSL（輸入後按「生成 3D」）</h3>
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          style={{ width: "100%", height: 200, background: "#0b0e13", color: "#ddd" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 16px" }}>
          <button onClick={() => handleGenerate()}>生成 3D</button>
          <button onClick={handleResetView}>重製視角</button>
          <button onClick={() => setShotAsk((x) => x + 1)}>截圖 PNG</button>
          <button onClick={exportGLB}>Export GLB</button>
          <button onClick={exportSTL}>Export STL</button>
          <button onClick={shareLink}>分享連結</button>
        </div>

        <h4 style={{ margin: "12px 0 8px" }}>Pins（點模型可插針）</h4>
        {pins.length === 0 && <div style={{ opacity: 0.7 }}>點 3D 模型來新增 Pin</div>}
        {pins.map((p) => (
          <div
            key={p.id}
            style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: 8 }}
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
        <Grid args={[500, 50]} />

        <SceneFromParams commands={cmds} exportRef={exportRootRef} />
        <FitOnceHelper
          exportRootRef={exportRootRef}
          controlsRef={controlsRef}
          initialPoseRef={initialPoseRef}
        />
        <PinLayer pins={pins} setPins={setPins} />

        <OrbitControls ref={controlsRef} makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport />
        </GizmoHelper>

        <ScreenshotTaker request={shotAsk} onDone={() => {}} />
      </Canvas>
    </div>
  );
}
