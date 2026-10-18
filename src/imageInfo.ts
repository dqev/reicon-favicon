import type { Info } from "./types";

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
};

export function mimeFor(format: string): string {
  return MIME[format] || "application/octet-stream";
}

function isSvg(head: string): boolean {
  return /<svg[\s>]/i.test(head);
}

export function sniff(bytes: Uint8Array): Info {
  if (bytes.length < 4) return { format: "bin", width: 0, height: 0 };

  const head = new TextDecoder().decode(bytes.slice(0, 640));
  if (isSvg(head)) {
    const w = /width\s*=\s*["']?([\d.]+)/i.exec(head);
    const h = /height\s*=\s*["']?([\d.]+)/i.exec(head);
    const vb = /viewBox\s*=\s*["']?\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(
      head,
    );
    const width = w ? parseFloat(w[1]) : vb ? parseFloat(vb[1]) : 0;
    const height = h ? parseFloat(h[1]) : vb ? parseFloat(vb[2]) : 0;
    return { format: "svg", width, height };
  }

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 24) return { format: "png", width: 0, height: 0 };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    if (bytes.length < 10) return { format: "gif", width: 0, height: 0 };
    return {
      format: "gif",
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    };
  }

  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    const count = bytes[4] | (bytes[5] << 8);
    let best = { w: 0, h: 0 };
    for (let i = 0; i < count && 6 + i * 16 + 1 < bytes.length; i++) {
      const off = 6 + i * 16;
      const w = bytes[off] || 256;
      const h = bytes[off + 1] || 256;
      if (w * h > best.w * best.h) best = { w, h };
    }
    return { format: "ico", width: best.w, height: best.h };
  }

  if (
    bytes.length > 16 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { format: "webp", width: w, height: h };
    }
    return { format: "webp", width: 0, height: 0 };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = view.getUint16(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          format: "jpeg",
          width: view.getUint16(i + 7),
          height: view.getUint16(i + 5),
        };
      }
      i += 2 + len;
    }
    return { format: "jpeg", width: 0, height: 0 };
  }

  return { format: "bin", width: 0, height: 0 };
}
