import * as THREE from "three";
import { CSG } from "three-csg-ts";

function mkBox({ w, h, d, pos }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color:"#8fb3ff" })
  );
  mesh.position.set(...pos);
  mesh.updateMatrix();
  return mesh;
}

function mkCyl({ r, h, pos, axis="y", color="#8fb3ff" }) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 48),
    new THREE.MeshStandardMaterial({ color })
  );
  mesh.position.set(...pos);
  if (axis === "x") mesh.rotation.set(0,0,Math.PI/2);
  else if (axis === "z") mesh.rotation.set(Math.PI/2,0,0);
  mesh.updateMatrix();
  return mesh;
}

/** NEW: 多邊形擠出 (pts 為世界 XZ，mesh 放在 pos，沿 +Y 擠出 h) */
function mkPrism({ pts, h, pos }) {
  // 以多邊形質心當局部原點，shape 使用平面 x,z → shape 的 x,y
  const centroid = pts.reduce((a,[x,z])=>[a[0]+x, a[1]+z],[0,0]).map(v=>v/pts.length);
  const shape = new THREE.Shape();
  pts.forEach(([x,z],i)=>{
    const px = x - centroid[0];
    const py = z - centroid[1];
    if (i===0) shape.moveTo(px, py); else shape.lineTo(px, py);
  });
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth:h, bevelEnabled:false, steps:1 });
  // 讓厚度置中（y: -h/2 → +h/2）
  geo.translate(0, -h/2, 0);

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:"#8fb3ff" }));
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.updateMatrix();
  return mesh;
}

// hole：沿 y 軸打孔（忽略輸入的 y，對齊底座中心）
function mkHoleCylinder({ dia, pos, depth, baseH }) {
  const r = dia/2;
  const h = depth==="thru" ? (baseH ?? 40)+2 : (typeof depth==="number" ? depth : 20);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 48),
    new THREE.MeshStandardMaterial({ color:"#ff4da6" })
  );
  const [x,,z] = pos;
  mesh.position.set(x, 0, z);
  mesh.updateMatrix();
  return mesh;
}

function mkMesh(c, baseHForHole) {
  if (c.type === "box") return mkBox(c);
  if (c.type === "cyl") return mkCyl(c);
  if (c.type === "poly") return mkPrism(c);
  if (c.type === "hole") return mkHoleCylinder({ ...c, baseH: baseHForHole });
  return null;
}

export default function SceneFromParams({ commands = [], exportRef }) {
  // 允許 poly 當基底
  const baseIdx = commands.findIndex(
    (c) => (c.type === "box" || c.type === "cyl" || c.type === "poly") && c.op !== "sub"
  );
  const baseCmd = baseIdx >= 0 ? commands[baseIdx] : null;

  if (!baseCmd) {
    // 沒基底：僅顯示「加法幾何」，洞顯示標記
    return (
      <>
        <group ref={exportRef}>
          {commands.map((c,i)=>{
            if (c.op === "sub" || c.type==="hole") return null;
            const m = mkMesh(c);
            return m ? <primitive key={i} object={m}/> : null;
          })}
        </group>
        {commands.map((c,i)=>
          c.type==="hole" ? (
            <mesh key={"mark-"+i} position={c.pos}>
              <sphereGeometry args={[Math.max(2, c.dia/3), 12, 12]} />
              <meshBasicMaterial color="red" wireframe />
            </mesh>
          ) : null
        )}
      </>
    );
  }

  // 有基底：CSG
  const baseMesh = mkMesh(baseCmd);
  let csg = CSG.fromMesh(baseMesh);

  // subtract（含 hole）
  for (const c of commands) {
    if (c === baseCmd) continue;
    if (c.op === "sub" || c.type === "hole") {
      const cutter = c.type==="hole"
        ? mkHoleCylinder({ ...c, baseH: baseCmd.h ?? baseCmd.depth ?? 40 })
        : mkMesh(c, baseCmd.h ?? 40);
      if (cutter) csg = csg.subtract(CSG.fromMesh(cutter));
    }
  }

  // union
  for (const c of commands) {
    if (c === baseCmd) continue;
    if (c.op !== "sub" && c.type !== "hole") {
      const add = mkMesh(c);
      if (add) csg = csg.union(CSG.fromMesh(add));
    }
  }

  const result = CSG.toMesh(csg, baseMesh.matrix, baseMesh.material.clone());
  result.castShadow = result.receiveShadow = true;

  return (
    <>
      <group ref={exportRef}>
        <primitive object={result}/>
      </group>
      {commands.map((c,i)=>
        c.type==="hole" ? (
          <mesh key={"mark-"+i} position={c.pos}>
            <sphereGeometry args={[Math.max(2, c.dia/3), 12, 12]} />
            <meshBasicMaterial color="red" wireframe />
          </mesh>
        ) : null
      )}
    </>
  );
}
