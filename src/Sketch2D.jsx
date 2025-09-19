import { useEffect, useRef, useState } from "react";

/** RDP 簡化 */
function simplifyRDP(points, eps = 2) {
  if (points.length <= 2) return points;
  const lineDist = (p, a, b) => {
    const A = p.x - a.x, B = p.y - a.y;
    const C = b.x - a.x, D = b.y - a.y;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D || 1e-6;
    let t = Math.max(0, Math.min(1, dot / len_sq));
    const xx = a.x + C * t, yy = a.y + D * t;
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

/** 粗略辨識：line / circle / rect / poly */
function recognizeStroke(pts) {
  if (pts.length < 6) return { kind: "free", pts };
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,sumX=0,sumY=0;
  for (const p of pts) {
    if (p.x<minX) minX=p.x; if (p.y<minY) minY=p.y;
    if (p.x>maxX) maxX=p.x; if (p.y>maxY) maxY=p.y;
    sumX+=p.x; sumY+=p.y;
  }
  const bbox = { x:minX, y:minY, w:Math.max(1,maxX-minX), h:Math.max(1,maxY-minY) };
  const center = { x:sumX/pts.length, y:sumY/pts.length };
  const closed = Math.hypot(pts[0].x-pts.at(-1).x, pts[0].y-pts.at(-1).y) < 16;

  // line（非閉合、長細比大）
  const aspect = bbox.w>bbox.h ? bbox.w/bbox.h : bbox.h/bbox.w;
  if (!closed && aspect > 6) return { kind:"line", bbox, center, pts:[pts[0], pts.at(-1)] };

  // 圓（閉合 + 半徑方差小）
  let rSum=0; for (const p of pts) rSum += Math.hypot(p.x-center.x,p.y-center.y);
  const rAvg=rSum/pts.length;
  let varSum=0; for (const p of pts){ const r=Math.hypot(p.x-center.x,p.y-center.y); varSum += (r-rAvg)**2; }
  const circularity = Math.sqrt(varSum/pts.length) / (rAvg||1);
  if (closed && circularity < 0.18) return { kind:"circle", bbox, center };

  // 矩形（閉合 + RDP 約 4~8 點 + 不像圓）
  const simp = simplifyRDP(pts, 4);
  if (closed && simp.length>=4 && simp.length<=8 && circularity>=0.18) {
    return { kind:"rect", bbox, center };
  }

  // 其他封閉圖形 → poly
  if (closed) {
    // 去尾重複點並簡化
    let arr = [...pts];
    if (Math.hypot(arr[0].x-arr.at(-1).x, arr[0].y-arr.at(-1).y) < 16) arr = arr.slice(0,-1);
    arr = simplifyRDP(arr, 3);
    if (arr.length >= 3) return { kind:"poly", bbox, center, pts:arr };
  }
  return { kind:"free", bbox, center, pts };
}

export default function Sketch2D({
  enabled,
  onExit,
  onCommit,          // (dslString) => void
  mmPerPx = 1,
  defaultBoxH = 20,  // 矩形/多邊形擠出高度 (mm)
  defaultCylH = 40,
  defaultHole = false,
}) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [stroke, setStroke] = useState([]);
  const [shapes, setShapes] = useState([]); // {kind, bbox, center, pts?}
  const [asHole, setAsHole] = useState(defaultHole);
  const [eraser, setEraser] = useState(false);

  // canvas 尺寸/DPR
  useEffect(() => {
    if (!enabled) return;
    const cvs = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = cvs.getBoundingClientRect();
    cvs.width = Math.round(rect.width * dpr);
    cvs.height = Math.round(rect.height * dpr);
    cvs.getContext("2d").setTransform(dpr,0,0,dpr,0,0);
  }, [enabled]);

  // 繪製背景 + 形狀 + 目前筆畫
  useEffect(() => {
    if (!enabled) return;
    const cvs = canvasRef.current, ctx = cvs.getContext("2d");
    const r = cvs.getBoundingClientRect();

    ctx.clearRect(0,0,r.width,r.height);
    ctx.fillStyle = "rgba(14,17,22,0.9)";
    ctx.fillRect(0,0,r.width,r.height);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
    const step = 50;
    for (let x = (r.width/2)%step; x < r.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,r.height); ctx.stroke();
    }
    for (let y = (r.height/2)%step; y < r.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(r.width,y); ctx.stroke();
    }
    // axes
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath(); ctx.moveTo(r.width/2,0); ctx.lineTo(r.width/2,r.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,r.height/2); ctx.lineTo(r.width,r.height/2); ctx.stroke();

    const drawPath = (arr, color) => {
      if (!arr || arr.length<2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(arr[0].x, arr[0].y);
      for (let i=1;i<arr.length;i++) ctx.lineTo(arr[i].x, arr[i].y);
      ctx.stroke();
    };

    // 已確定形狀
    for (const s of shapes) {
      if (s.kind === "circle") {
        const cx = s.bbox.x + s.bbox.w/2, cy = s.bbox.y + s.bbox.h/2;
        const r = Math.max(s.bbox.w, s.bbox.h)/2;
        ctx.strokeStyle = "rgba(255,200,0,0.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
      } else if (s.kind === "rect") {
        ctx.strokeStyle = "rgba(255,200,0,0.9)"; ctx.lineWidth = 2;
        ctx.strokeRect(s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h);
      } else if (s.kind === "poly") {
        drawPath([...s.pts, s.pts[0]], "rgba(255,200,0,0.9)");
      } else if (s.kind === "line") {
        drawPath(s.pts, "rgba(255,200,0,0.9)");
      }
    }
    // 目前筆畫
    drawPath(stroke, "rgba(173,216,230,0.95)");
  }, [enabled, stroke, shapes]);

  // 事件
  useEffect(() => {
    if (!enabled) return;
    const cvs = canvasRef.current;

    const getPos = (e) => {
      const r = cvs.getBoundingClientRect();
      return { x:(e.touches?e.touches[0].clientX:e.clientX)-r.left,
               y:(e.touches?e.touches[0].clientY:e.clientY)-r.top };
    };

    const down = (e) => {
      e.preventDefault();
      const p = getPos(e);
      if (eraser) {
        setShapes(arr => arr.filter(s => {
          const testPts = s.kind==="circle"||s.kind==="rect" ? [
            {x:s.bbox.x,y:s.bbox.y},
            {x:s.bbox.x+s.bbox.w,y:s.bbox.y+s.bbox.h}
          ] : s.pts;
          return !testPts.some(pt => Math.hypot(pt.x-p.x, pt.y-p.y) < 10);
        }));
        return;
      }
      setDragging(true);
      setStroke([p]);
    };
    const move = (e) => {
      if (!dragging) return;
      e.preventDefault();
      setStroke(list => list.concat(getPos(e)));
    };
    const up = (e) => {
      if (!dragging) return;
      e.preventDefault();
      setDragging(false);
      setStroke(list => {
        const guess = recognizeStroke(list);
        if (guess && (guess.kind!=="free")) {
          setShapes(arr => arr.concat(guess));
        }
        return [];
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
  }, [enabled, dragging, eraser]);

  if (!enabled) return null;

  // px → mm（原點在畫布中心；x=水平，z=垂直向下為正）
  const pxToMM = (p) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = rect.width/2, cy = rect.height/2;
    return { x:(p.x-cx)*mmPerPx, z:(p.y-cy)*mmPerPx };
  };

  // 送出：把 shapes 轉 DSL（box / cylinder / hole / poly）
  const handleSubmit = () => {
    const lines = [];
    for (const s of shapes) {
      if (s.kind === "rect") {
        const w = Math.round(s.bbox.w * mmPerPx);
        const d = Math.round(s.bbox.h * mmPerPx);
        const h = Math.round(defaultBoxH);
        const c = pxToMM({x:s.bbox.x+s.bbox.w/2, y:s.bbox.y+s.bbox.h/2});
        lines.push(`box w=${w} h=${h} d=${d} at(${Math.round(c.x)},${Math.round(h/2)},${Math.round(c.z)})`);
      } else if (s.kind === "circle") {
        const rpx = Math.max(s.bbox.w, s.bbox.h)/2;
        const r = Math.max(1, Math.round(rpx * mmPerPx));
        const c = pxToMM({x:s.bbox.x+s.bbox.w/2, y:s.bbox.y+s.bbox.h/2});
        if (asHole) {
          lines.push(`hole dia=${r*2} at(${Math.round(c.x)},0,${Math.round(c.z)}) depth=thru`);
        } else {
          const h = Math.round(defaultCylH);
          lines.push(`cylinder r=${r} h=${h} at(${Math.round(c.x)},${Math.round(h/2)},${Math.round(c.z)}) axis=y`);
        }
      } else if (s.kind === "poly") {
        // poly h=.. pts=(x1,z1),(x2,z2)...
        const ptsMM = s.pts.map(p => pxToMM(p))
          .map(v => `(${Math.round(v.x)},${Math.round(v.z)})`).join(",");
        const centroid = pxToMM({x:s.center.x, y:s.center.y});
        const h = Math.round(defaultBoxH);
        lines.push(`poly h=${h} at(${Math.round(centroid.x)},${Math.round(h/2)},${Math.round(centroid.z)}) pts=${ptsMM}`);
      } else if (s.kind === "line") {
        // 可選：用細長 box 表示
        const p1 = pxToMM(s.pts[0]), p2 = pxToMM(s.pts[1]);
        const mid = { x:Math.round((p1.x+p2.x)/2), z:Math.round((p1.z+p2.z)/2) };
        lines.push(`box w=${Math.max(1,Math.round(Math.hypot(p2.x-p1.x,p2.z-p1.z)))} h=1 d=1 at(${mid.x},1,${mid.z})`);
      }
    }
    if (lines.length) onCommit?.(lines.join(";\n") + ";");
    setShapes([]); // 清空 2D
  };

  return (
    <div style={{ position:"absolute", inset:0, zIndex:5 }}>
      <canvas ref={canvasRef} style={{ width:"100%", height:"100%", cursor: eraser?"not-allowed":"crosshair", touchAction:"none" }}/>
      <div style={{
        position:"absolute", top:12, left:12, display:"flex", gap:8, alignItems:"center",
        background:"rgba(0,0,0,0.65)", border:"1px solid #333", padding:"8px 10px",
        borderRadius:8, color:"#ddd", backdropFilter:"blur(4px)"
      }}>
        <strong>✏️ 2D 草圖 → 3D</strong>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={asHole} onChange={e=>setAsHole(e.target.checked)}/>畫圓當作孔
        </label>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={eraser} onChange={e=>setEraser(e.target.checked)}/>橡皮擦
        </label>
        <button onClick={()=>{setShapes([]); setStroke([]);}}>清除</button>
        <button onClick={handleSubmit} disabled={!shapes.length}>✓ 送出</button>
        <button onClick={onExit}>關閉</button>
      </div>
    </div>
  );
}
