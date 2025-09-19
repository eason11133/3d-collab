// src/SceneFromParams.jsx
import * as THREE from "three";
import { CSG } from "three-csg-ts";

/* ---------- 基本幾何 ---------- */
function mkBox({ w, h, d, pos }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: "#8fb3ff",
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  mesh.position.set(...pos);
  mesh.updateMatrix();
  return mesh;
}

function mkCyl({ r, h, pos, axis = "y", color = "#d1a860" }) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 48),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(...pos);
  if (axis === "x") mesh.rotation.set(0, 0, Math.PI / 2);
  else if (axis === "z") mesh.rotation.set(Math.PI / 2, 0, 0);
  mesh.updateMatrix();
  return mesh;
}

/* ---------- 2D 多邊形擠出（poly） ----------
   期望輸入：
   { type:"poly", pts:[{x,z},...], h:number, pos:[x,y,z], op:"add"|"sub" }
   說明：
   - 以 pts 的 XZ 畫出 Shape，沿局部 +Z 擠出 depth=h
   - 然後把 Z 軸旋轉到世界 Y（rotateX(+90°)），使 h 成為「高度」
   - 幾何再上移 h/2，使幾何中心落在 pos（和 box/cyl 一致）
*/
function mkPoly({ pts = [], h = 1, pos = [0, 0, 0], color = "#8fb3ff" }) {
  if (!Array.isArray(pts) || pts.length < 3) return null;

  // 建 shape（用 XZ → 畫在 XY，Z 先當作 Y 使用）
  const shape = new THREE.Shape();
  pts.forEach((p, i) => {
    const sx = Number(p.x) || 0;
    const sy = Number(p.z) || 0; // 用 z 當作平面 y
    if (i === 0) shape.moveTo(sx, sy);
    else shape.lineTo(sx, sy);
  });
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, h),
    bevelEnabled: false,
    steps: 1,
  });

  // 將擠出的 Z 軸轉成世界 Y
  geo.rotateX(Math.PI / 2);
  // 讓厚度中心落在 y=0（與 box/cyl 一致）
  geo.translate(0, h / 2, 0);

  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.8,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.updateMatrix();
  return mesh;
}

/* ---------- hole：沿 y 軸打孔（忽略輸入 y，置於 y=0） ---------- */
function mkHoleCylinder({ dia, pos, depth, baseH }) {
  const r = dia / 2;
  const h =
    depth === "thru"
      ? (baseH ?? 40) + 2 // 多 2mm 避免 CSG 邊界誤差
      : typeof depth === "number"
      ? depth
      : 20;

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 48),
    new THREE.MeshStandardMaterial({ color: "#ff4da6" })
  );
  const [x, , z] = pos;
  mesh.position.set(x, 0, z);
  mesh.updateMatrix();
  return mesh;
}

/* ---------- 工廠 ---------- */
function mkMesh(c, baseHForHole) {
  if (c.type === "box") return mkBox(c);
  if (c.type === "cyl") return mkCyl(c);
  if (c.type === "poly") return mkPoly(c);
  if (c.type === "hole") return mkHoleCylinder({ ...c, baseH: baseHForHole });
  return null;
}

/* ================================================================== */

export default function SceneFromParams({ commands = [], exportRef }) {
  // ✅ 把「第一個加法幾何（box / cyl / poly）」當成基底
  const baseIdx = commands.findIndex(
    (c) => (c.type === "box" || c.type === "cyl" || c.type === "poly") && c.op !== "sub"
  );
  const baseCmd = baseIdx >= 0 ? commands[baseIdx] : null;

  // 沒有可當基底的幾何 → 直接畫出加法幾何（不做 CSG），洞只顯示標記
  if (!baseCmd) {
    return (
      <>
        <group ref={exportRef}>
          {commands.map((c, i) => {
            if (c.op === "sub") return null; // 無基底無法 subtract
            if (c.type === "box") return <primitive key={i} object={mkBox(c)} />;
            if (c.type === "cyl") return <primitive key={i} object={mkCyl(c)} />;
            if (c.type === "poly") return <primitive key={i} object={mkPoly(c)} />;
            return null;
          })}
        </group>

        {/* 洞的紅色標記（提示用，不匯出） */}
        {commands.map((c, i) =>
          c.type === "hole" ? (
            <mesh key={"mark-" + i} position={c.pos}>
              <sphereGeometry args={[Math.max(2, c.dia / 3), 12, 12]} />
              <meshBasicMaterial color="red" wireframe />
            </mesh>
          ) : null
        )}
      </>
    );
  }

  // ✅ 有基底：做 CSG（先 subtract 再 union）
  const baseMesh =
    baseCmd.type === "box" ? mkBox(baseCmd) :
    baseCmd.type === "cyl" ? mkCyl(baseCmd) :
    mkPoly(baseCmd);

  let csg = CSG.fromMesh(baseMesh);

  // subtract（包含 hole 與 op=sub）
  for (const c of commands) {
    if (c === baseCmd) continue;
    if (c.op === "sub" || c.type === "hole") {
      const cutter =
        c.type === "hole"
          ? mkHoleCylinder({ ...c, baseH: baseCmd.h ?? 40 })
          : mkMesh(c, baseCmd.h ?? 40);
      if (cutter) csg = csg.subtract(CSG.fromMesh(cutter));
    }
  }

  // union（其餘加法幾何）
  for (const c of commands) {
    if (c === baseCmd) continue;
    if (c.op !== "sub" && c.type !== "hole") {
      const addMesh = mkMesh(c);
      if (addMesh) csg = csg.union(CSG.fromMesh(addMesh));
    }
  }

  // 轉回 mesh
  const resultMat = baseMesh.material.clone?.() || new THREE.MeshStandardMaterial({ color: "#8fb3ff" });
  const result = CSG.toMesh(csg, baseMesh.matrix, resultMat);
  result.castShadow = result.receiveShadow = true;

  return (
    <>
      <group ref={exportRef}>
        <primitive object={result} />
      </group>

      {/* 洞的紅色標記（不匯出） */}
      {commands.map((c, i) =>
        c.type === "hole" ? (
          <mesh key={"mark-" + i} position={c.pos}>
            <sphereGeometry args={[Math.max(2, c.dia / 3), 12, 12]} />
            <meshBasicMaterial color="red" wireframe />
          </mesh>
        ) : null
      )}
    </>
  );
}
