// 解析 DSL 成 commands；支援：box / cylinder / hole / poly
// 回傳：[{type, ...}, ...]
export function parseDSL(text = "") {
  const cmds = [];
  const lines = (text || "")
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(Boolean);

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
    };

  const boxRE = /^box\s+w=([\d\.\-]+)\s+h=([\d\.\-]+)\s+d=([\d\.\-]+)(?:\s+at\(([\-0-9\.]+),([\-\d\.]+),([\-\d\.]+)\))?(?:\s+op=(add|sub))?$/i;
  const cylRE = /^cylinder\s+r=([\d\.\-]+)\s+h=([\d\.\-]+)(?:\s+at\(([\-0-9\.]+),([\-\d\.]+),([\-\d\.]+)\))?(?:\s+axis=(x|y|z))?(?:\s+op=(add|sub))?$/i;
  const holeRE = /^hole\s+dia=([\d\.\-]+)\s+at\(([\-0-9\.]+),([\-\d\.]+),([\-\d\.]+)\)(?:\s+depth=(thru|[\d\.\-]+))?$/i;
  // poly pts=x1,z1;x2,z2;... h=H at(x,y,z) [op=sub]
  const polyRE = /^poly\s+pts=([0-9,\-;\s]+)\s+h=([\d\.]+)\s+at\(([\-0-9\.]+),([\-\d\.]+),([\-\d\.]+)\)(?:\s+op=(add|sub))?$/i;

  for (let raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();

    // box
    let m = line.match(boxRE);
    if (m) {
      const w = num(m[1]), h = num(m[2]), d = num(m[3]);
      const x = num(m[4] ?? 0), y = num(m[5] ?? 0), z = num(m[6] ?? 0);
      const op = (m[7] || "add").toLowerCase();
      cmds.push({ type: "box", w, h, d, pos: [x, y, z], op });
      continue;
    }

    // cylinder
    m = line.match(cylRE);
    if (m) {
      const r = num(m[1]), h = num(m[2]);
      const x = num(m[3] ?? 0), y = num(m[4] ?? 0), z = num(m[5] ?? 0);
      const axis = (m[6] || "y").toLowerCase();
      const op = (m[7] || "add").toLowerCase();
      cmds.push({ type: "cyl", r, h, pos: [x, y, z], axis, op });
      continue;
    }

    // hole
    m = line.match(holeRE);
    if (m) {
      const dia = num(m[1]);
      const x = num(m[2]), y = num(m[3]), z = num(m[4]);
      const depthRaw = (m[5] || "thru").toLowerCase();
      const depth = depthRaw === "thru" ? "thru" : num(depthRaw);
      cmds.push({ type: "hole", dia, pos: [x, y, z], depth });
      continue;
    }

    // poly
    m = line.match(polyRE);
    if (m) {
      const ptsRaw = m[1].trim();
      const h = num(m[2]);
      const x = num(m[3]), y = num(m[4]), z = num(m[5]);
      const op = (m[6] || "add").toLowerCase();
      const pts = ptsRaw.split(";").map(pair => {
        const [px, pz] = pair.split(",").map(Number);
        return { x: px, z: pz };
      }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
      if (pts.length >= 3 && Number.isFinite(h)) {
        cmds.push({ type: "poly", pts, h, pos: [x, y, z], op });
      }
      continue;
    }

    // 無法解析的行，略過
  }

  return cmds;
}
