// src/nl.js
// 中文 → DSL 解析器（支援中文數字、單位、常見口語、多點位 / 中心點等）
// 匯出 parseNL 與 looksLikeDSL 供 App.jsx 使用

const ZH_DIGIT = { "零":0,"〇":0,"一":1,"二":2,"兩":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9 };

function zhWordToInt(s) {
  if (!s) return null;
  s = String(s).replace(/两/g, "兩");
  // 簡易：十/百/千
  let total = 0, section = 0, num = 0;
  const units = { "千":1000, "百":100, "十":10 };
  for (const ch of s) {
    if (ch in ZH_DIGIT) {
      num = ZH_DIGIT[ch];
    } else if (ch in units) {
      section += (num === 0 && ch === "十") ? 10 : num * units[ch];
      num = 0;
    }
  }
  total += section + num;
  return total || null;
}

function parseNumber(token) {
  if (token == null) return null;
  token = String(token).trim();

  // 抓阿拉伯數字或中文數字
  let val = null;
  const m = token.match(/[-+]?\d+(?:\.\d+)?/);
  if (m) val = parseFloat(m[0]);
  if (val == null) {
    const zh = zhWordToInt(token);
    if (zh != null) val = zh;
  }
  if (val == null) return null;

  // 單位換算：cm/公分→mm；mm/毫米/公厘→原值（其他視為 mm）
  if (/(?:cm|公分)/i.test(token)) val *= 10;
  return val;
}

function pickAxis(text) {
  if (!text) return "y";
  if (/沿?\s*[xX]/.test(text)) return "x";
  if (/沿?\s*[zZ]/.test(text)) return "z";
  if (/沿?\s*[yY]/.test(text)) return "y";
  if (/直立|豎著/.test(text)) return "y";
  if (/橫著|躺著/.test(text)) return "x";
  if (/側躺/.test(text)) return "z";
  return "y";
}

function parseVec3All(text) {
  // 抓 (x,y,z) 列表：在(10,0,0)、(30,0,0) …
  if (!text) return [];
  const out = [];
  const re = /\(\s*([-+]?\d+(?:\.\d+)?)\s*[,，\s]\s*([-+]?\d+(?:\.\d+)?)\s*[,，\s]\s*([-+]?\d+(?:\.\d+)?)\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    out.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }
  return out;
}

function atCenterWanted(text) {
  return /(在)?(中心|中心點|原點|中間)/.test(text);
}

function looksLikeDSLInput(s) {
  return /\bbox\b|\bcylinder\b|\bhole\b|\bat\s*\(|\bw\s*=|\bh\s*=|\bd\s*=/.test(s);
}

function splitSentences(input) {
  return String(input || "")
    .replace(/[；;、]+/g, ";")
    .replace(/[。\.]+/g, ";")
    .split(/[\n;]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

// ===== 主解析：把自然語句轉成 DSL 多行 =====
export function naturalToDSL(input) {
  const lines = [];
  if (!input) return "";

  const sentences = splitSentences(input);

  for (let s of sentences) {
    // 去掉語助詞
    s = s.replace(/^(再來|然後|接著|請|幫我|麻煩|先|把|再)/, "").trim();

    // 位置：多個或中心
    const poses = parseVec3All(s);
    const center = atCenterWanted(s);
    const atStrs = (poses.length > 0 ? poses : (center ? [[0,0,0]] : [])).map(
      v => ` at(${v[0]},${v[1]},${v[2]})`
    );
    const atOrEmpty = atStrs.length ? atStrs : [""]; // 至少一筆，便於展開

    // === BOX ===
    if (/(底座|基座|盒子|方塊|長方體|板子)/.test(s)) {
      let w, h, d;

      // 1) 80x20x50 / 80×20×50 / 80 * 20 * 50（可含單位）
      const mDim = s.match(
        /(\d+(?:\.\d+)?(?:\s*(?:mm|公分|cm)?)?)\s*[x×*]\s*(\d+(?:\.\d+)?(?:\s*(?:mm|公分|cm)?)?)\s*[x×*]\s*(\d+(?:\.\d+)?(?:\s*(?:mm|公分|cm)?)?)/i
      );
      if (mDim) {
        w = parseNumber(mDim[1]);
        h = parseNumber(mDim[2]);
        d = parseNumber(mDim[3]);
      } else {
        // 2) 寬/高/深/厚 關鍵字
        const mW = s.match(/(?:寬|長|寬度|長度)\s*=?\s*([-\w\.]+(?:\s*(?:mm|公分|cm))?)/);
        const mH = s.match(/(?:高|厚|高度|厚度)\s*=?\s*([-\w\.]+(?:\s*(?:mm|公分|cm))?)/);
        const mD = s.match(/(?:深|深度)\s*=?\s*([-\w\.]+(?:\s*(?:mm|公分|cm))?)/);
        w = mW ? parseNumber(mW[1]) : undefined;
        h = mH ? parseNumber(mH[1]) : undefined;
        d = mD ? parseNumber(mD[1]) : undefined;
      }
      if (w == null) w = 80;
      if (h == null) h = 20;
      if (d == null) d = 50;

      for (const at of atOrEmpty) lines.push(`box w=${w} h=${h} d=${d}${at}`);
      continue;
    }

    // === HOLE ===
    if (/(孔|洞|穿孔|螺絲孔)/.test(s)) {
      let dia = null, depth = "thru";

      const mDia = s.match(/直徑\s*=?\s*([-\w\.]+)/);
      const mRad = s.match(/半徑\s*=?\s*([-\w\.]+)/);
      if (mDia) dia = parseNumber(mDia[1]);
      if (!dia && mRad) {
        const r = parseNumber(mRad[1]); if (r != null) dia = r * 2;
      }
      if (!dia) {
        const mFree = s.match(/([-\w\.]+)\s*(?:mm|公分|cm)?\s*(?:的)?\s*(?:孔|洞)/);
        if (mFree) dia = parseNumber(mFree[1]);
      }
      if (dia == null) dia = 8;

      if (/(貫穿|穿透|打通|穿過)/.test(s)) {
        depth = "thru";
      } else {
        const mDepth = s.match(/(?:深|深度)\s*=?\s*([-\w\.]+)/);
        if (mDepth) {
          const v = parseNumber(mDepth[1]);
          if (v != null) depth = v;
        }
      }

      for (const at of atOrEmpty) {
        lines.push(`hole dia=${dia}${at}${depth === "thru" ? "" : ` depth=${depth}`}`);
      }
      continue;
    }

    // === CYLINDER ===
    if (/(圓柱|柱子|圓桿|圓管)/.test(s)) {
      const axis = pickAxis(s);
      let r = null, h = null;

      const mR = s.match(/半徑\s*=?\s*([-\w\.]+)/);
      const mD = s.match(/直徑\s*=?\s*([-\w\.]+)/);
      if (mR) r = parseNumber(mR[1]);
      if (!r && mD) {
        const dia = parseNumber(mD[1]); if (dia != null) r = dia / 2;
      }
      if (!r) r = 10;

      const mH = s.match(/(?:高|高度|長|長度)\s*=?\s*([-\w\.]+)/);
      if (mH) h = parseNumber(mH[1]); else h = 30;

      const op = /(挖|扣|減|打孔|鑿|用來挖洞)/.test(s) ? "sub" : "add";

      for (const at of atOrEmpty) {
        lines.push(`cylinder r=${r} h=${h}${at} axis=${axis} op=${op}`);
      }
      continue;
    }

    // 其他句型：暫忽略（可再擴充）
  }

  return lines.join(";\n");
}

// 供外部快速判斷輸入是不是 DSL
export function looksLikeDSL(s) {
  return looksLikeDSLInput(String(s || ""));
}

// 為了與 App.jsx 相容，提供 parseNL 名稱（實際呼叫 naturalToDSL）
export function parseNL(text) {
  return naturalToDSL(text);
}
