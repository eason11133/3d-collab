// src/Sketch2D.jsx
import { useEffect, useRef, useState } from "react";

/** 小工具：壓縮折線（RDP） */
function simplifyRDP(points, eps = 2) {
  if (points.length <= 2) return points;
  const lineDist = (p, a, b) => {
    const x = p.x, y = p.y;
    const x1 = a.x, y1 = a.y;
    const x2 = b.x, y2 = b.y;
    const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D || 1e-6;
    let t = dot / len_sq;
    t = Math.max(0, Math.min(1, t));
    const xx = x1 + C * t;
    const yy = y1 + D * t;
    const dx = x - xx, dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };
  let dmax = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = lineDist(points[i], points[0], points[points.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const left = simplifyRDP(points.slice(0, idx + 1), eps);
    const right = simplifyRDP(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

/** 形狀辨識：回傳 {kind, bbox:{x,y,w,h}, center:{x,y}, r} */
function recognizeStroke(pts) {
  if (pts.length < 6) return null;
  // 基本量
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sumX = 0, sumY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    sumX += p.x; sumY += p.y;
  }
  const bbox = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  const center = { x: sumX / pts.length, y: sumY / pts.length };

  const dx = pts[0].x - pts[pts.length - 1].x;
  const dy = pts[0].y - pts[pts.length - 1].y;
  const closed = Math.hypot(dx, dy) < 16;

  // 長細比 + 圓度
  const aspect = bbox.w > bbox.h ? bbox.w / bbox.h : bbox.h / bbox.w;

  // 圓度：半徑平均與偏差
  let rSum = 0;
  for (const p of pts) rSum += Math.hypot(p.x - center.x, p.y - center.y);
  const rAvg = rSum / pts.length;
  let varSum = 0;
  for (const p of pts) {
    const r = Math.hypot(p.x - center.x, p.y - center.y);
    varSum += Math.pow(r - rAvg, 2);
  }
  const rStd = Math.sqrt(varSum / pts.length);
  const circularity = rStd / (rAvg || 1);

  // 直線：長細比很大且非閉合
  if (!closed && aspect > 4) {
    return { kind: "line", bbox, center };
  }

  // 圓：閉合 + 圓度夠高
  if (closed && circularity < 0.18) {
    return { kind: "circle", bbox, center, r: (bbox.w + bbox.h) / 4 };
  }

  // 矩形：化簡後大概四點 + 閉合 + 不太像圓
  const simp = simplifyRDP(pts, 4);
  if (closed && simp.length >= 4 && simp.length <= 8 && circularity > 0.18) {
    return { kind: "rect", bbox, center };
  }

  // 其他暫不處理
  return null;
}

export default function Sketch2D({
  enabled,
  onExit,
  onCommit,          // (dslString) => void
  mmPerPx = 1,       // 幅尺換算
  defaultBoxH = 10,  // 矩形擠出厚度(mm)
  defaultCylH = 40,  // 圓柱高度(mm)
  defaultHole = false, // 畫圓時當作孔
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pts, setPts] = useState([]);
  const [lastGuess, setLastGuess] = useState(null);
  const [asHole, setAsHole] = useState(defaultHole);

  // 調整尺寸 & 清畫面
  useEffect(() => {
    if (!enabled) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = cvs.getBoundingClientRect();
    cvs.width = Math.round(rect.width * dpr);
    cvs.height = Math.round(rect.height * dpr);
    const ctx = cvs.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    // 畫淡淡的格線
    ctx.fillStyle = "rgba(14,17,22,0.85)";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    const step = 50;
    for (let x = (rect.width/2) % step; x < rect.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke();
    }
    for (let y = (rect.height/2) % step; y < rect.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke();
    }
    // 中心十字
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.moveTo(rect.width/2, 0); ctx.lineTo(rect.width/2, rect.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, rect.height/2); ctx.lineTo(rect.width, rect.height/2); ctx.stroke();
  }, [enabled]);

  // 畫當前筆跡 + 預測
  useEffect(() => {
    if (!enabled) return;
    const cvs = canvasRef.current;
    const ctx = cvs.getContext("2d");
    const rect = cvs.getBoundingClientRect();

    // 先重畫背景格線（簡單做法：整塊重置）
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(14,17,22,0.85)";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    const step = 50;
    for (let x = (rect.width/2) % step; x < rect.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke();
    }
    for (let y = (rect.height/2) % step; y < rect.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.moveTo(rect.width/2, 0); ctx.lineTo(rect.width/2, rect.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, rect.height/2); ctx.lineTo(rect.width, rect.height/2); ctx.stroke();

    // 畫筆跡
    if (pts.length > 1) {
      ctx.strokeStyle = "rgba(173,216,230,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // 畫預測的邊界盒
    if (lastGuess) {
      const { bbox, kind } = lastGuess;
      ctx.strokeStyle = kind === "circle" ? "rgba(0,255,170,0.9)" :
                        kind === "rect"   ? "rgba(255,200,0,0.9)" :
                        "rgba(255,120,120,0.9)";
      ctx.lineWidth = 2;
      if (kind === "circle") {
        const r = Math.max(bbox.w, bbox.h) / 2;
        ctx.beginPath();
        ctx.arc(bbox.x + bbox.w/2, bbox.y + bbox.h/2, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
      }
    }
  }, [enabled, pts, lastGuess]);

  useEffect(() => {
    if (!enabled) return;
    const wrap = wrapRef.current;
    const cvs = canvasRef.current;

    const getPos = (e) => {
      const r = cvs.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x, y };
    };

    const down = (e) => {
      e.preventDefault();
      setDragging(true);
      setPts([getPos(e)]);
      setLastGuess(null);
    };
    const move = (e) => {
      if (!dragging) return;
      e.preventDefault();
      setPts((arr) => arr.concat(getPos(e)));
    };
    const up = (e) => {
      if (!dragging) return;
      e.preventDefault();
      setDragging(false);
      setPts((arr) => {
        const guess = recognizeStroke(arr);
        setLastGuess(guess);
        return arr;
      });
    };

    cvs.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      cvs.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [enabled, dragging]);

  if (!enabled) return null;

  // 將螢幕像素 → 世界 mm（x,z），原點在畫布中心
  const pxToMM = (p) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x_mm = (p.x - cx) * mmPerPx;
    const z_mm = (p.y - cy) * mmPerPx; // 往下為 +Z
    return { x_mm, z_mm };
  };

  // 將預測轉成 DSL
  const buildDSL = () => {
    if (!lastGuess) return "";
    const { kind, bbox, center } = lastGuess;
    const c = pxToMM(center);
    if (kind === "rect") {
      const w = Math.round(bbox.w * mmPerPx);
      const d = Math.round(bbox.h * mmPerPx);
      const h = Math.round(defaultBoxH);
      const y = Math.round(h / 2);
      return `box w=${w} h=${h} d=${d} at(${Math.round(c.x_mm)},${y},${Math.round(c.z_mm)});`;
    }
    if (kind === "circle") {
      const r = Math.max(bbox.w, bbox.h) * mmPerPx / 2;
      if (asHole) {
        const dia = Math.round(r * 2);
        return `hole dia=${dia} at(${Math.round(c.x_mm)},0,${Math.round(c.z_mm)}) depth=thru;`;
      } else {
        const h = Math.round(defaultCylH);
        const y = Math.round(h / 2);
        return `cylinder r=${Math.round(r)} h=${h} at(${Math.round(c.x_mm)},${y},${Math.round(c.z_mm)}) axis=y;`;
      }
    }
    // line：暫不轉
    return "";
  };

  const acceptShape = () => {
    const dsl = buildDSL();
    if (dsl) onCommit?.(dsl);
    // 清空
    setPts([]);
    setLastGuess(null);
  };

  const clearStroke = () => {
    setPts([]);
    setLastGuess(null);
  };

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        pointerEvents: "auto",
        display: "flex",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
      {/* 工具列 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(0,0,0,0.65)",
          border: "1px solid #333",
          padding: "8px 10px",
          borderRadius: 8,
          color: "#ddd",
          backdropFilter: "blur(4px)",
        }}
      >
        <strong>✏️ 2D 草圖 → 3D</strong>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={asHole}
            onChange={(e) => setAsHole(e.target.checked)}
          />
          畫圓當作孔
        </label>
        <button onClick={clearStroke}>清除</button>
        <button onClick={acceptShape} disabled={!lastGuess}>✓ 送出</button>
        <button onClick={onExit}>關閉</button>
      </div>
    </div>
  );
}
