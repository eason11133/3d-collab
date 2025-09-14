// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  GizmoHelper,
  GizmoViewport,
  Bounds,
  useBounds,
} from "@react-three/drei";
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

/* ------- 工具：置中相機 ------- */
function AutoFit({ deps }) {
  const api = useBounds();
  useEffect(() => {
    api.refresh().fit();
  }, [api, deps]);
  return null;
}

/* ------- 工具：穩定截圖（保留緩衝、等一幀後 toBlob） ------- */
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

/* ------- 共用：Blob 下載 ------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------- 匯出前整理（套變換/法線/材質） ------- */
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

/* ------- 分享連結編解碼 ------- */
function encodeShare(payload) {
  const txt = JSON.stringify(payload);
  // UTF-8 safe base64
  return btoa(unescape(encodeURIComponent(txt)));
}
function decodeShare(s) {
  try {
    const txt = decodeURIComponent(escape(atob(s)));
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export default function App() {
  const [src, setSrc] = useState(() => localStorage.getItem("dsl") || SAMPLE);
  const [cmds, setCmds] = useState(() =>
    parseDSL(localStorage.getItem("dsl") || SAMPLE)
  );

  const [nl, setNL] = useState(""); // 中文描述
  const [pins, setPins] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pins") || "[]");
    } catch {
      return [];
    }
  });

  const [resetAsk, setResetAsk] = useState(0);
  const [shotAsk, setShotAsk] = useState(0);
  const exportRootRef = useRef(); // 只包「可匯出」的實體

  // 讀分享連結（?s=...）
  useEffect(() => {
    const u = new URL(window.location.href);
    const s = u.searchParams.get("s");
    if (s) {
      const p = decodeShare(s);
      if (p?.dsl) {
        setSrc(p.dsl);
        setCmds(parseDSL(p.dsl));
      }
      if (Array.isArray(p?.pins)) setPins(p.pins);
      // 清掉 query（避免存到 localStorage 後每次重整又套一次）
      u.searchParams.delete("s");
      window.history.replaceState({}, "", u.pathname);
    }
  }, []);

  // 本地儲存
  useEffect(() => {
    localStorage.setItem("dsl", src);
  }, [src]);
  useEffect(() => {
    localStorage.setItem("pins", JSON.stringify(pins));
  }, [pins]);

  const deps = useMemo(
    () => JSON.stringify({ cmds, resetAsk }),
    [cmds, resetAsk]
  );

  /* ------- 匯出 GLB ------- */
  function exportGLB() {
    const root = exportRootRef.current;
    if (!root) return alert("沒有可匯出的幾何，請先按「生成 3D」。");
    const safe = prepareExportRoot(root);
    const exporter = new GLTFExporter();
    exporter.parse(
      safe,
      (res) => {
        let blob;
        if (res instanceof ArrayBuffer) {
          blob = new Blob([res], { type: "model/gltf-binary" });
        } else if (res && res.buffer instanceof ArrayBuffer) {
          blob = new Blob([res.buffer], { type: "model/gltf-binary" });
        } else if (typeof res === "object") {
          blob = new Blob([JSON.stringify(res)], {
            type: "application/json",
          });
        } else {
          alert("匯出失敗：未知輸出格式");
          return;
        }
        downloadBlob(blob, `model-${Date.now()}.glb`);
      },
      { binary: true, onlyVisible: true, truncateDrawRange: true, embedImages: true }
    );
  }

  /* ------- 匯出 STL（ASCII） ------- */
  function exportSTL() {
    const root = exportRootRef.current;
    if (!root) return alert("沒有可匯出的幾何，請先按「生成 3D」。");
    const safe = prepareExportRoot(root);
    const exporter = new STLExporter();
    const stlText = exporter.parse(safe, { binary: false });
    const blob = new Blob([stlText], { type: "model/stl" });
    downloadBlob(blob, `model-${Date.now()}.stl`);
  }

  /* ------- 分享連結 ------- */
  async function shareLink() {
    const payload = { dsl: src, pins };
    const s = encodeShare(payload);
    const url = `${location.origin}${location.pathname}?s=${s}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("已複製分享連結到剪貼簿！");
    } catch {
      prompt("複製這個分享連結：", url);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "340px 1fr",
        height: "100vh",
      }}
    >
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
          style={{
            width: "100%",
            height: 90,
            background: "#0b0e13",
            color: "#ddd",
            marginBottom: 8,
          }}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            onClick={() => {
              const dsl = parseNL(nl);
              if (!dsl) return alert("抱歉，這段中文我看不懂，再換個說法試試 🙏");
              setSrc(dsl);
              setCmds(parseDSL(dsl));
              setResetAsk((x) => x + 1);
            }}
          >
            中文 → 生成
          </button>

          <select
            onChange={(e) => {
              const found = EXAMPLES.find((x) => x.dsl === e.target.value);
              if (found) {
                setSrc(found.dsl);
                setCmds(parseDSL(found.dsl));
                setResetAsk((x) => x + 1);
              }
            }}
            defaultValue=""
            style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
          >
            <option value="" disabled>
              載入範例…
            </option>
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
          style={{
            width: "100%",
            height: 200,
            background: "#0b0e13",
            color: "#ddd",
          }}
        />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            margin: "8px 0 16px",
          }}
        >
          <button
            onClick={() => {
              setCmds(parseDSL(src));
              setResetAsk((x) => x + 1);
            }}
          >
            生成 3D
          </button>
          <button onClick={() => setResetAsk((x) => x + 1)}>重置視角</button>
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
                setPins((arr) =>
                  arr.map((x) =>
                    x.id === p.id ? { ...x, note: e.target.value } : x
                  )
                )
              }
              style={{
                background: "#0b0e13",
                color: "#ddd",
                border: "1px solid #333",
                padding: "6px 8px",
                borderRadius: 6,
              }}
            />
            <button onClick={() => setPins((arr) => arr.filter((x) => x.id !== p.id))}>
              刪除
            </button>
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

        <Bounds clip observe margin={1}>
          <SceneFromParams commands={cmds} exportRef={exportRootRef} />
          <PinLayer pins={pins} setPins={setPins} />
          <AutoFit deps={deps} />
          <ScreenshotTaker request={shotAsk} onDone={() => {}} />
        </Bounds>

        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
