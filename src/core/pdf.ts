import { inflateSync } from "node:zlib";

function decodePdfString(s: string): string {
  // Handle octal escapes like \( \) \\ and \n \r \t \b \f
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const next = s[i + 1];
      if (next === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (next === "r") {
        out += "\r";
        i++;
        continue;
      }
      if (next === "t") {
        out += "\t";
        i++;
        continue;
      }
      if (next === "b") {
        out += "\b";
        i++;
        continue;
      }
      if (next === "f") {
        out += "\f";
        i++;
        continue;
      }
      if (next === "(" || next === ")" || next === "\\") {
        out += next;
        i++;
        continue;
      }
      if (/[0-7]/.test(next)) {
        // octal
        let num = next;
        if (/[0-7]/.test(s[i + 2])) {
          num += s[i + 2];
          i++;
        }
        if (/[0-7]/.test(s[i + 2])) {
          num += s[i + 2];
          i++;
        }
        out += String.fromCharCode(parseInt(num, 8));
        i++;
        continue;
      }
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function extractStringsFromTJ(s: string): string[] {
  const results: string[] = [];
  // TJ array form: [(...) ... (..) -200 (...)]
  const arrayMatch = s.match(/\[([\s\S]*?)\]/);
  if (arrayMatch) {
    const inner = arrayMatch[1];
    // match all strings
    const strRe = /\(([\s\S]*?)\)/g;
    let m;
    while ((m = strRe.exec(inner)) !== null) {
      results.push(decodePdfString(m[1]));
    }
    return results;
  }
  // single string
  const strRe2 = /\(([\s\S]*?)\)\s*Tj/;
  const m2 = s.match(strRe2);
  if (m2) {
    results.push(decodePdfString(m2[1]));
  }
  return results;
}

function extractTextFromContent(content: string): string {
  const parts: string[] = [];
  // Look for BT ... ET blocks
  const btRe = /BT[\s\S]*?ET/g;
  let btMatch;
  while ((btMatch = btRe.exec(content)) !== null) {
    const block = btMatch[0];
    // Tj
    const tjRe = /\(([\s\S]*?)\)\s*Tj/g;
    let tj;
    while ((tj = tjRe.exec(block)) !== null) {
      parts.push(decodePdfString(tj[1]));
    }
    // TJ
    const tjArrRe = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArr;
    while ((tjArr = tjArrRe.exec(block)) !== null) {
      const inner = tjArr[1];
      const strRe = /\(([\s\S]*?)\)/g;
      let sm;
      while ((sm = strRe.exec(inner)) !== null) {
        parts.push(decodePdfString(sm[1]));
      }
    }
    // Also check for Tj/TJ outside arrays in some forms
  }
  // If no BT/ET found, try to find all Tj/TJ globally
  if (parts.length === 0) {
    const tjRe = /\(([\s\S]*?)\)\s*Tj/g;
    let tj;
    while ((tj = tjRe.exec(content)) !== null) {
      parts.push(decodePdfString(tj[1]));
    }
    const tjArrRe = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArr;
    while ((tjArr = tjArrRe.exec(content)) !== null) {
      const inner = tjArr[1];
      const strRe = /\(([\s\S]*?)\)/g;
      let sm;
      while ((sm = strRe.exec(inner)) !== null) {
        parts.push(decodePdfString(sm[1]));
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function extractPdfText(buf: ArrayBuffer | Uint8Array): string | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const data = Buffer.from(bytes);
  // Check PDF header
  if (data.length < 4) return null;
  const header = data.slice(0, 8).toString("latin1");
  if (!header.includes("%PDF")) return null;

  let result = "";
  // Look for stream objects with FlateDecode
  // Pattern: stream ... endstream
  const str = data.toString("latin1");
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRe.exec(str)) !== null) {
    const streamData = Buffer.from(match[1], "latin1");
    // Try to find if this stream is FlateDecode - look backwards from stream
    const before = str.slice(Math.max(0, match.index - 2000), match.index);
    if (/\/Filter\s*\/FlateDecode/i.test(before) || /\/Filter\s*\[\s*\/FlateDecode/i.test(before)) {
      try {
        const inflated = inflateSync(streamData);
        const inflatedStr = inflated.toString("latin1");
        const text = extractTextFromContent(inflatedStr);
        if (text) {
          result += (result ? "\n" : "") + text;
        }
      } catch (e) {
        // try to continue
      }
    } else {
      // Also try to extract from uncompressed streams
      const text = extractTextFromContent(match[1]);
      if (text) {
        result += (result ? "\n" : "") + text;
      }
    }
  }

  if (!result.trim()) {
    // Fallback: try to extract all strings from PDF
    const allTj = [];
    const tjRe = /\(([\s\S]*?)\)\s*Tj/g;
    let tj;
    while ((tj = tjRe.exec(str)) !== null) {
      allTj.push(decodePdfString(tj[1]));
    }
    const tjArrRe = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArr;
    while ((tjArr = tjArrRe.exec(str)) !== null) {
      const inner = tjArr[1];
      const strRe = /\(([\s\S]*?)\)/g;
      let sm;
      while ((sm = strRe.exec(inner)) !== null) {
        allTj.push(decodePdfString(sm[1]));
      }
    }
    result = allTj.join(" ").replace(/\s+/g, " ").trim();
  }

  return result.trim() ? result.trim() : null;
}
