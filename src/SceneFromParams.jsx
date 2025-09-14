// src/SceneFromParams.jsx
import * as THREE from "three";
import { CSG } from "three-csg-ts";

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

// hole：沿 y 軸打孔（忽略輸入的 y，對齊底座中心）
function mkHoleCylinder({ dia, pos, depth, baseH }) {
  const r = dia / 2;
  const h =
    depth === "thru"
      ? (baseH ?? 40) + 2
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

function mkMesh(c, baseHForHole) {
  if (c.type === "box") return mkBox(c);
  if (c.type === "cyl") return mkCyl(c);
  if (c.type === "hole") return mkHoleCylinder({ ...c, baseH: baseHForHole });
  return null;
}

export default function SceneFromParams({ commands = [], exportRef }) {
  // ✅ 把「第一個加法幾何（box 或 cyl）」當成基底
  const baseIdx = commands.findIndex(
    (c) => (c.type === "box" || c.type === "cyl") && c.op !== "sub"
  );
  const baseCmd = baseIdx >= 0 ? commands[baseIdx] : null;

  // 沒有可當基底的幾何 → 直接畫出加法幾何（不做 CSG），洞只顯示標記
  if (!baseCmd) {
    return (
      <>
        <group ref={exportRef}>
          {commands.map((c, i) => {
            if (c.op === "sub") return null; // 沒基底無法 subtract
            if (c.type === "box") return <primitive key={i} object={mkBox(c)} />;
            if (c.type === "cyl") return <primitive key={i} object={mkCyl(c)} />;
            return null;
          })}
        </group>
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
    baseCmd.type === "box" ? mkBox(baseCmd) : mkCyl(baseCmd);
  let csg = CSG.fromMesh(baseMesh);

  // subtract（包含 hole）
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

  const result = CSG.toMesh(csg, baseMesh.matrix, baseMesh.material.clone());
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
