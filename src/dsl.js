// src/dsl.js
export function parseDSL(src) {
  const cmds = [];
  for (const raw of src.split(";")) {
    const line = raw.trim();
    if (!line) continue;

    const space = line.indexOf(" ");
    const cmd = space > 0 ? line.slice(0, space) : line;
    const rest = space > 0 ? line.slice(space + 1) : "";

    const str = (k, defVal = "") => {
      const m = new RegExp(`${k}\\s*=\\s*([^\\s)]+)`, "i").exec(rest);
      return m ? m[1] : defVal;
    };
    const num = (k, defVal) => {
      const m = new RegExp(`${k}\\s*=\\s*([-\\d.]+)`, "i").exec(rest);
      return m ? parseFloat(m[1]) : defVal;
    };
    const at = () => {
      const m = /at\s*\(\s*([-.\d]+)\s*,\s*([-.\d]+)\s*,\s*([-.\d]+)\s*\)/i.exec(rest);
      return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : [0, 0, 0];
    };
    const op = str("op", "add").toLowerCase(); // add / sub

    if (cmd === "box") {
      cmds.push({ type: "box", w: num("w", 80), h: num("h", 20), d: num("d", 50), pos: at(), op });
    } else if (cmd === "cylinder") {
      const axis = (str("axis", "y") || "y").toLowerCase();
      cmds.push({ type: "cyl", r: num("r", 10), h: num("h", 30), pos: at(), axis, op });
    } else if (cmd === "hole") {
      // 預設穿透（depth = thru）；也可自訂 depth（數字）
      const depthToken = str("depth", "thru");
      const depth = depthToken.toLowerCase() === "thru" ? "thru" : parseFloat(depthToken);
      cmds.push({ type: "hole", dia: num("dia", 8), pos: at(), depth, op: "sub" });
    }
  }
  return cmds;
}
