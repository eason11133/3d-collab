import { useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import SceneFromParams from "./SceneFromParams";
import { parseDSL } from "./dsl";
import { parseNL } from "./nl";
import PinLayer from "./PinLayer";
import DrawTool from "./DrawTool";
import Sketch2D from "./Sketch2D";
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

// 初始空場景
const SAMPLE = "";

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

/* ---------- 一次置中到幾何；可記錄姿態 ---------- */
function fitToExportRoot({ root, camera, controls, recordPoseRef, record = false }) {
  if (!root) return;
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

/* ---------- 讓外部能呼叫 FIT / RESTORE ---------- */
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
  // 初始空場景
  const [src, setSrc] = useState(SAMPLE);
  const [cmds, setCmds] = useState([]);
  const [nl, setNL] = useState("");

  const [pins, setPins] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pins") || "[]");
    } catch {
      return [];
    }
  });
  const [shotAsk, setShotAsk] = useState(0);

  // 繪圖 UI 狀態
  const [drawEnabled, setDrawEnabled] = useState(false);
  const [drawShape, setDrawShape] = useState("box");      // 'box' | 'cyl' | 'hole'
  const [drawOp, setDrawOp] = useState("add");            // 'add' | 'sub'
  const [drawHeight, setDrawHeight] = useState(20);
  const [holeDia, setHoleDia] = useState(8);
  const [snapStep, setSnapStep] = useState(5);            // mm；0/1=>關閉

  // 2D 草圖 overlay 狀態
  const [showSketch2D, setShowSketch2D] = useState(false);
  const [mmPerPx, setMmPerPx] = useState(0.5);
  const [sketchAsHole, setSketchAsHole] = useState(false);

  // 幾何根 / 控制器 / 「生成當下相機姿態」
  const exportRootRef = useRef();
  const controlsRef = useRef();
  const initialPoseRef = useRef(null);

  // 分享連結參數（?s=...）
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

  /* ---------- 工具：cmd 轉 DSL 行 ---------- */
  const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
  const cmdToDSL = (c) => {
    if (c.type === "box")
      return `box w=${round(c.w)} h=${round(c.h)} d=${round(c.d)} at(${round(c.pos[0])},${round(
        c.pos[1]
      )},${round(c.pos[2])})${c.op === "sub" ? " op=sub" : ""}`;
    if (c.type === "cyl")
      return `cylinder r=${round(c.r)} h=${round(c.h)} at(${round(c.pos[0])},${round(
        c.pos[1]
      )},${round(c.pos[2])}) axis=${c.axis || "y"}${c.op === "sub" ? " op=sub" : ""}`;
    if (c.type === "hole") {
      const depth = c.depth === "thru" ? "" : ` depth=${round(c.depth)}`;
      return `hole dia=${round(c.dia)} at(${round(c.pos[0])},${round(c.pos[1])},${round(
        c.pos[2]
      )})${depth}`;
    }
    return "";
  };

  // 追加 DSL 的小工具（合併多行、避免重複分號）
  const appendDSL = (prev, add) => {
    const base = (prev || "").trim().replace(/;+$/,"");
    const addTrim = (add || "").trim().replace(/;+$/,"");
    if (!addTrim) return base;
    return base ? `${base};\n${addTrim};` : `${addTrim};`;
  };

  /* ---------- 生成 3D ---------- */
  const handleGenerate = (dslText) => {
    const text = dslText ?? src;
    setSrc(text);
    if (!text.trim()) {
      setCmds([]);
      return;
    }
    setCmds(parseDSL(text));
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: true } }));
    });
  };

  /* ---------- 重設視角 ---------- */
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

  /* ---------- 復原一筆 ---------- */
  const undoLast = () => {
    if (cmds.length === 0) return;
    const next = cmds.slice(0, -1);
    setCmds(next);
    const dsl = next.map(cmdToDSL).filter(Boolean).join(";\n");
    setSrc(dsl ? dsl + ";" : "");
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: false } }));
    });
  };

  /* ---------- 繪圖提交：插入 cmds + 同步 DSL ---------- */
  const handleDrawCreate = (cmd) => {
    setCmds((prev) => [...prev, cmd]);
    setSrc((prev) => {
      const line = cmdToDSL(cmd);
      return prev ? `${prev.trim().replace(/;+$/,"")};\n${line};` : `${line};`;
    });
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: false } }));
    });
  };

  /* ---------- 2D 草圖提交：支援多筆（lines）並直接生成 3D ---------- */
  const handleSketchCommit = (dslText) => {
    if (!dslText) return;
    // dslText 可能是多行：逐行清理、用分號連接
    const lines = dslText.split(/\n+/).map((l) => l.trim().replace(/;+$/,"")).filter(Boolean);
    const merged = lines.join(";\n") + ";";
    const next = appendDSL(src, merged);
    setSrc(next);
    setCmds(parseDSL(next));
    // 直接視角貼齊
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("FIT_ONCE", { detail: { record: false } }));
    });
  };

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
              handleGenerate(dsl);
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
              <option key={ex.label} value={ex.dsl}>{ex.label}</option>
            ))}
          </select>
        </div>

        {/* 繪圖模式設定 */}
        <h3 style={{ margin: "12px 0 8px" }}>✏️ 繪圖模式</h3>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 8 }}>
          <label>啟用</label>
          <input type="checkbox" checked={drawEnabled} onChange={(e) => setDrawEnabled(e.target.checked)} />
          <label>形狀</label>
          <select
            value={drawShape}
            onChange={(e) => setDrawShape(e.target.value)}
            style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
          >
            <option value="box">方塊（在地面上拖出寬/深）</option>
            <option value="cyl">圓柱（拖出半徑）</option>
            <option value="hole">孔（點一下放置）</option>
          </select>

          {drawShape !== "hole" && (
            <>
              <label>運算</label>
              <select
                value={drawOp}
                onChange={(e) => setDrawOp(e.target.value)}
                style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
              >
                <option value="add">加（Union）</option>
                <option value="sub">減（Subtract）</option>
              </select>
              <label>高度 (mm)</label>
              <input
                type="number"
                value={drawHeight}
                onChange={(e) => setDrawHeight(Math.max(1, Number(e.target.value) || 1))}
                style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
              />
            </>
          )}

          {drawShape === "hole" && (
            <>
              <label>孔徑 (mm)</label>
              <input
                type="number"
                value={holeDia}
                onChange={(e) => setHoleDia(Math.max(1, Number(e.target.value) || 1))}
                style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
              />
            </>
          )}

          <label>格線吸附 (mm)</label>
          <input
            type="number"
            value={snapStep}
            onChange={(e) => setSnapStep(Math.max(0, Number(e.target.value) || 0))}
            title="0 或 1 表示關閉吸附"
            style={{ background: "#0b0e13", color: "#ddd", padding: "6px 8px" }}
          />
        </div>

        {/* 2D 草圖設定 */}
        <h3 style={{ margin: "12px 0 8px" }}>🧭 2D 草圖（平面 → 3D）</h3>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 8 }}>
          <label>開啟 2D 草圖板</label>
          <input type="checkbox" checked={showSketch2D} onChange={(e) => setShowSketch2D(e.target.checked)} />
          <label>像素→毫米 (mm/px)</label>
          <input
            type="number"
            step="0.1"
            value={mmPerPx}
            onChange={(e)=>setMmPerPx(Math.max(0.05, Number(e.target.value)||0.1))}
            style={{ background:"#0b0e13", color:"#ddd", padding:"6px 8px" }}
          />
          <label>畫圓當作孔</label>
          <input type="checkbox" checked={sketchAsHole} onChange={(e)=>setSketchAsHole(e.target.checked)} />
        </div>
        <div style={{ fontSize:12, opacity:.7, marginBottom:8 }}>
          提示：2D 原點在畫布正中央；水平是 X、垂直是 Z。送出後會自動貼齊視角。
        </div>

        <h3 style={{ margin: "12px 0 8px" }}>DSL（輸入後按「生成 3D」）</h3>
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          placeholder="目前是空的。用上方中文或繪圖產生，或手動輸入 DSL 後按「生成 3D」。"
          style={{ width: "100%", height: 200, background: "#0b0e13", color: "#ddd" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 16px" }}>
          <button onClick={() => handleGenerate()}>生成 3D</button>
          <button onClick={handleResetView}>重製視角</button>
          <button onClick={undoLast}>復原上一步</button>
          <button
            onClick={() => {
              setSrc("");
              setCmds([]);
              setPins([]);
              localStorage.removeItem("dsl");
              localStorage.removeItem("pins");
            }}
          >
            新專案（清空）
          </button>
          <button onClick={() => setShotAsk((x) => x + 1)}>截圖 PNG</button>
          <button onClick={exportGLB}>Export GLB</button>
          <button onClick={exportSTL}>Export STL</button>
          <button onClick={shareLink}>分享連結</button>
        </div>

        <h4 style={{ margin: "12px 0 8px" }}>Pins（點模型可插針）</h4>
        {pins.length === 0 && <div style={{ opacity: 0.7 }}>點 3D 模型來新增 Pin</div>}
        {pins.map((p) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginBottom: 8 }}>
            <input
              value={p.note}
              placeholder={`備註（${p.pos.map((n) => n.toFixed(1)).join(", ")})`}
              onChange={(e) =>
                setPins((arr) => arr.map((x) => (x.id === p.id ? { ...x, note: e.target.value } : x)))
              }
              style={{ background: "#0b0e13", color: "#ddd", border: "1px solid #333", padding: "6px 8px", borderRadius: 6 }}
            />
            <button onClick={() => setPins((arr) => arr.filter((x) => x.id !== p.id))}>刪除</button>
          </div>
        ))}
      </div>

      {/* 右側 3D 畫布（用 relative 容器包起來，讓 2D overlay 蓋上去） */}
      <div style={{ position: "relative" }}>
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

          {/* 幾何 */}
          <SceneFromParams commands={cmds} exportRef={exportRootRef} />

          {/* 繪圖工具（在 y=0 平面） */}
          <DrawTool
            enabled={drawEnabled}
            shape={drawShape}
            op={drawOp}
            height={drawHeight}
            holeDia={holeDia}
            snapStep={snapStep}
            onCreate={handleDrawCreate}
          />

          {/* 相機控制輔助 */}
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

        {/* 2D 草圖 overlay */}
        {showSketch2D && (
          <Sketch2D
            enabled
            onExit={() => setShowSketch2D(false)}
            onCommit={handleSketchCommit}
            mmPerPx={mmPerPx}
            defaultBoxH={drawHeight}
            defaultCylH={drawHeight}
            defaultHole={sketchAsHole}
          />
        )}
      </div>
    </div>
  );
}
