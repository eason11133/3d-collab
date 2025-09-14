import { useEffect, useRef, useState } from "react";

/** 壓縮折線（RDP） */
function simplifyRDP(points, eps = 2) {
  if (points.length <= 2) return points;
  const lineDist = (p, a, b) => {
    const A = p.x - a.x, B = p.y - a.y;
    const C = b.x - a.x, D = b.y - a.y;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D || 1e-6;
    let t = dot / len_sq;
    t = Math.max(0, Math.min(1, t));
    const xx = a.x + C * t;
    const yy = a.y + D * t;
    return Math.hypot(p.x - xx, p.y - yy);
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

/** 將辨識到的圖形自動矯正為標準形狀 */
function snapShape(kind, pts) {
  if (kind === "line") {
    const p1 = pts[0], p2 = pts[pts.length - 1];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return [{x:p1.x,y:p1.y},{x:p2.x,y:p1.y}];
    } else {
      return [{x:p1.x,y:p1.y},{x:p1.x,y:p2.y}];
    }
  }
  if (kind === "circle") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
    const r = Math.max(maxX-minX,maxY-minY)/2;
    const out = [];
    for (let i=0;i<32;i++){
      const a = (i/32)*Math.PI*2;
      out.push({x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r});
    }
    return out;
  }
  if (kind === "rect") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return [
      {x:minX,y:minY},
      {x:maxX,y:minY},
      {x:maxX,y:maxY},
      {x:minX,y:maxY},
      {x:minX,y:minY},
    ];
  }
  return pts;
}

/** 圖形辨識 + 類型推斷 */
function recognizeStroke(pts) {
  if (pts.length < 6) return null;
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

  const aspect = bbox.w > bbox.h ? bbox.w / bbox.h : bbox.h / bbox.w;

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

  if (!closed && aspect > 4) return { kind: "line", bbox, center, pts: snapShape("line", pts) };
  if (closed && circularity < 0.18) return { kind: "circle", bbox, center, pts: snapShape("circle", pts) };
  const simp = simplifyRDP(pts, 4);
  if (closed && simp.length >= 4 && simp.length <= 8 && circularity > 0.18) {
    return { kind: "rect", bbox, center, pts: snapShape("rect", pts) };
  }
  return null;
}

export default function Sketch2D({
  enabled,
  onExit,
  onCommit,
  mmPerPx = 1,
  defaultBoxH = 10,
  defaultCylH = 40,
  defaultHole = false,
}) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pts, setPts] = useState([]);
  const [lastGuess, setLastGuess] = useState(null);
  const [asHole, setAsHole] = useState(defaultHole);

  // 畫背景+筆跡
  const draw = () => {
    const cvs = canvasRef.current;
    const ctx = cvs.getContext("2d");
    const rect = cvs.getBoundingClientRect();
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

    if (pts.length > 1) {
      ctx.strokeStyle = "rgba(173,216,230,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  };
  useEffect(draw, [pts, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const cvs = canvasRef.current;

    const getPos = (e) => {
      const r = cvs.getBoundingClientRect();
      return {
        x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left,
        y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top,
      };
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
        const first = arr[0];
        const last = arr[arr.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 16) {
          arr.push(first);
        }
        const guess = recognizeStroke(arr);
        setLastGuess(guess);
        return guess?.pts || arr;
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

  const pxToMM = (p) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    return { x: (p.x - cx) * mmPerPx, z: (p.y - cy) * mmPerPx };
  };

  const buildDSL = () => {
    if (!lastGuess) return "";
    const { kind, bbox, center } = lastGuess;
    const c = pxToMM(center);
    if (kind === "rect") {
      const w = Math.round(bbox.w * mmPerPx);
      const d = Math.round(bbox.h * mmPerPx);
      const h = Math.round(defaultBoxH);
      return `box w=${w} h=${h} d=${d} at(${Math.round(c.x)},${Math.round(h/2)},${Math.round(c.z)});`;
    }
    if (kind === "circle") {
      const r = Math.max(bbox.w, bbox.h) * mmPerPx / 2;
      if (asHole) return `hole dia=${Math.round(r*2)} at(${Math.round(c.x)},0,${Math.round(c.z)}) depth=thru;`;
      else return `cylinder r=${Math.round(r)} h=${defaultCylH} at(${Math.round(c.x)},${Math.round(defaultCylH/2)},${Math.round(c.z)}) axis=y;`;
    }
    return "";
  };

  const acceptShape = () => {
    const dsl = buildDSL();
    if (dsl) onCommit?.(dsl);
    setPts([]);
    setLastGuess(null);
  };

  return (
    <div style={{position:"absolute",inset:0,zIndex:5}}>
      <canvas ref={canvasRef} style={{width:"100%",height:"100%",cursor:"crosshair",touchAction:"none"}}/>
      <div style={{
        position:"absolute",top:12,left:12,display:"flex",gap:8,
        background:"rgba(0,0,0,0.65)",padding:"8px 10px",borderRadius:8,color:"#ddd"
      }}>
        <strong>✏️ 2D 草圖 → 3D</strong>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={asHole} onChange={(e)=>setAsHole(e.target.checked)}/>畫圓當作孔
        </label>
        <button onClick={()=>{setPts([]);setLastGuess(null);}}>清除</button>
        <button onClick={acceptShape} disabled={!lastGuess}>✓ 送出</button>
        <button onClick={onExit}>關閉</button>
      </div>
    </div>
  );
}
