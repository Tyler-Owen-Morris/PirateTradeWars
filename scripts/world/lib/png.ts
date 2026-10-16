// Minimal pure-JS PNG encoder (8-bit RGB, no interlace) on node:zlib. Avoids native canvas deps.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode width*height*3 RGB bytes as a PNG. Per row picks the filter (None/Sub/Up/Paeth) with the
 *  smallest sum of absolute residuals, the usual heuristic. */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  const types = [0, 1, 2, 4];
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestScore = Infinity;
    for (let c = 0; c < 4; c++) {
      const o = cand[c];
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? row[x - 3] : 0;
        const b = prev ? prev[x] : 0;
        const cc = prev && x >= 3 ? prev[x - 3] : 0;
        let pred = 0;
        if (c === 1) pred = a;
        else if (c === 2) pred = b;
        else if (c === 3) {
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (row[x] - pred) & 0xff;
        o[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    raw[y * (stride + 1)] = types[best];
    Buffer.from(cand[best].buffer).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
