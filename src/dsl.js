// src/dsl.js
export function parseDSL(text) {
  const lines = (text || "")
    .split(/[\n;]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const cmds = [];

  for (const ln of lines) {
    const s = ln.replace(/\s+/g, " ").toLowerCase();

    // box w=.. h=.. d=.. at(x,y,z) [op=sub]
    if (s.startsWith("box")) {
      const w = +val(s,"w")||10, h=+val(s,"h")||10, d=+val(s,"d")||10;
      const pos = vec3(s) || [0,h/2,0];
      const op = pick(s,"op")==="sub" ? "sub" : "add";
      cmds.push({ type:"box", w,h,d, pos, op });
      continue;
    }

    // cylinder r=.. h=.. at(x,y,z) axis=x|y|z [op=sub]
    if (s.startsWith("cylinder")) {
      const r=+val(s,"r")||5, h=+val(s,"h")||10;
      const pos = vec3(s) || [0,h/2,0];
      const axis = pick(s,"axis")||"y";
      const op = pick(s,"op")==="sub" ? "sub" : "add";
      cmds.push({ type:"cyl", r,h, pos, axis, op });
      continue;
    }

    // hole dia=.. at(x,y,z) depth=thru|number
    if (s.startsWith("hole")) {
      const dia=+val(s,"dia")||5;
      const pos = vec3(s) || [0,0,0];
      const depthTxt = pick(s,"depth");
      const depth = depthTxt==="thru" ? "thru" : (depthTxt?+depthTxt: "thru");
      cmds.push({ type:"hole", dia, pos, depth });
      continue;
    }

    // NEW: poly h=.. at(x,y,z) pts=(x1,z1),(x2,z2),...
    if (s.startsWith("poly")) {
      const h=+val(s,"h")||10;
      const pos = vec3(s) || [0,h/2,0];
      const ptsStr = s.match(/pts\s*=\s*([^\s]+)/)?.[1] || "";
      const pts = [];
      ptsStr.split("),").forEach(tok=>{
        const m = tok.replace(/[()]/g,"").split(",");
        if (m.length===2) pts.push([+m[0], +m[1]]);
      });
      if (pts.length>=3) cmds.push({ type:"poly", h, pos, pts, op: pick(s,"op")==="sub"?"sub":"add" });
      continue;
    }
  }

  return cmds;
}

function val(s, key){ return +(s.match(new RegExp(`${key}\\s*=\\s*([\\d\\.\\-]+)`))?.[1]||""); }
function pick(s, key){ return s.match(new RegExp(`${key}\\s*=\\s*([a-z0-9_\\-]+)`))?.[1]; }
function vec3(s){
  const m = s.match(/at\s*\(\s*([\-0-9\.]+)\s*,\s*([\-0-9\.]+)\s*,\s*([\-0-9\.]+)\s*\)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
