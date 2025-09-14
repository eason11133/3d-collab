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
  const h = depth === "thru" ? (baseH ?? 40) + 2 : (typeof depth === "number" ? depth : 20);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 48),
    new THREE.MeshStandardMaterial({ color: "#ff4da6" })
  );
  const [x, , z] = pos;
  mesh.position.set(x, 0, z);
  mesh.updateMatrix();
  return mesh;
}

export default function SceneFromParams({ commands = [], exportRef }) {
  // 找第一個 add 的 box 當底座
  const baseCmd = commands.find((c) => c.type === "box" && c.op !== "sub");

  // 沒底座就只畫 add 幾何（無 CSG）
  if (!baseCmd) {
    return (
      <>
        <group ref={exportRef} name="EXPORT_ROOT" userData={{ exportable: true }}>
          {commands.map((c, i) => {
            if (c.type === "box" && c.op !== "sub") return <primitive key={i} object={mkBox(c)} />;
            if (c.type === "cyl" && c.op !== "sub") return <primitive key={i} object={mkCyl(c)} />;
            return null;
          })}
        </group>
        {commands.map((c, i) =>
          c.type === "hole" ? (
            <mesh key={"mark-" + i} position={c.pos}>
              <sphereGeometry args={[c.dia / 2, 16, 16]} />
              <meshBasicMaterial color="red" wireframe />
            </mesh>
          ) : null
        )}
      </>
    );
  }

  // CSG：底座 -> subtract -> union
  const baseMesh = mkBox(baseCmd);
  let csg = CSG.fromMesh(baseMesh);

  for (const c of commands) {
    if (c === baseCmd) continue;
    if (c.op === "sub") {
      let cutter;
      if (c.type === "cyl") cutter = mkCyl({ ...c, color: "#888888" });
      else if (c.type === "hole") cutter = mkHoleCylinder({ ...c, baseH: baseCmd.h });
      else if (c.type === "box") cutter = mkBox(c);
      if (cutter) csg = csg.subtract(CSG.fromMesh(cutter));
    }
  }
  for (const c of commands) {
    if (c === baseCmd) continue;
    if (c.op !== "sub") {
      let addMesh;
      if (c.type === "box") addMesh = mkBox(c);
      else if (c.type === "cyl") addMesh = mkCyl(c);
      if (addMesh) csg = csg.union(CSG.fromMesh(addMesh));
    }
  }

  const result = CSG.toMesh(csg, baseMesh.matrix, baseMesh.material.clone());
  result.castShadow = result.receiveShadow = true;

  // 匯出根只包可匯出的實體；孔位紅球是視覺標記（不進匯出）
  return (
    <>
      <group ref={exportRef} name="EXPORT_ROOT" userData={{ exportable: true }}>
        <primitive object={result} />
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
