import { crc32, deflateSync, inflateSync } from "node:zlib";
import { TRANSPARENT, pack } from "../core/color.ts";
import { PxError } from "../core/errors.ts";
import { Img } from "../core/image.ts";

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG bytes: indexed (with tRNS) when the image has <= 256 colors, RGBA otherwise. */
export function encodePng(img: Img): Buffer {
  const { w, h, data } = img;
  const index = new Map<number, number>();
  for (let i = 0; i < data.length && index.size <= 256; i++) if (!index.has(data[i])) index.set(data[i], index.size);
  const indexed = index.size <= 256;

  const rowLen = indexed ? w + 1 : w * 4 + 1;
  const raw = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    let o = y * rowLen + 1; // filter byte 0
    for (let x = 0; x < w; x++) {
      const c = data[y * w + x];
      if (indexed) raw[o++] = index.get(c)!;
      else { raw[o++] = c >>> 24; raw[o++] = (c >>> 16) & 255; raw[o++] = (c >>> 8) & 255; raw[o++] = c & 255; }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = indexed ? 3 : 6;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (indexed) {
    const colors = [...index.keys()];
    const plte = Buffer.alloc(colors.length * 3), trns = Buffer.alloc(colors.length);
    let lastAlpha = -1;
    colors.forEach((c, i) => {
      plte[i * 3] = c >>> 24; plte[i * 3 + 1] = (c >>> 16) & 255; plte[i * 3 + 2] = (c >>> 8) & 255;
      trns[i] = c === TRANSPARENT ? 0 : c & 255;
      if (trns[i] !== 255) lastAlpha = i;
    });
    parts.push(chunk("PLTE", plte));
    if (lastAlpha >= 0) parts.push(chunk("tRNS", trns.subarray(0, lastAlpha + 1)));
  }
  parts.push(chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** Decode any standard PNG (all color types and bit depths, interlaced or not) to an Img. */
export function decodePng(buf: Uint8Array, name = "png"): Img {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) throw new PxError(`${name}: not a PNG file`);
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let plte: Buffer | undefined, trns: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let o = 8; o + 8 <= b.length;) {
    const len = b.readUInt32BE(o), kind = b.toString("ascii", o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === "PLTE") plte = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    o += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!w || !h || !channels) throw new PxError(`${name}: unsupported or corrupt PNG header`);
  if (type === 3 && !plte) throw new PxError(`${name}: indexed PNG without a palette`);
  const raw = inflateSync(Buffer.concat(idat));
  const img = new Img(w, h);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const max = (1 << depth) - 1;
  // Color-key transparency for gray/RGB images (compared at the source bit depth).
  const key = trns && type === 0 ? [trns.readUInt16BE(0)] : trns && type === 2 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : undefined;
  let pos = 0;

  const pass = (px0: number, py0: number, dx: number, dy: number) => {
    const pw = Math.ceil((w - px0) / dx), ph = Math.ceil((h - py0) / dy);
    if (pw <= 0 || ph <= 0) return;
    const stride = Math.ceil((pw * channels * depth) / 8);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[pos++];
      const line = Buffer.from(raw.subarray(pos, pos + stride));
      pos += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (filter === 1) v += a;
        else if (filter === 2) v += up;
        else if (filter === 3) v += (a + up) >> 1;
        else if (filter === 4) {
          const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
        }
        line[i] = v & 255;
      }
      prev = line;
      const sample = (n: number): number => {
        if (depth === 8) return line[n];
        if (depth === 16) return line.readUInt16BE(n * 2);
        const bit = n * depth;
        return (line[bit >> 3] >> (8 - depth - (bit & 7))) & max;
      };
      const to8 = (v: number) => depth === 16 ? v >> 8 : Math.round((v * 255) / max);
      for (let x = 0; x < pw; x++) {
        const s = x * channels;
        let c: number;
        if (type === 3) {
          const i = sample(x);
          c = pack(plte![i * 3], plte![i * 3 + 1], plte![i * 3 + 2], trns && i < trns.length ? trns[i] : 255);
        } else if (type === 0 || type === 4) {
          const g = sample(s);
          const alpha = type === 4 ? to8(sample(s + 1)) : key && g === key[0] ? 0 : 255;
          c = pack(to8(g), to8(g), to8(g), alpha);
        } else {
          const r = sample(s), g = sample(s + 1), bl = sample(s + 2);
          const alpha = type === 6 ? to8(sample(s + 3)) : key && r === key[0] && g === key[1] && bl === key[2] ? 0 : 255;
          c = pack(to8(r), to8(g), to8(bl), alpha);
        }
        img.data[(py0 + y * dy) * w + px0 + x * dx] = (c & 255) === 0 ? TRANSPARENT : c;
      }
    }
  };

  if (interlace) for (const [x0, y0, dx, dy] of ADAM7) pass(x0, y0, dx, dy);
  else pass(0, 0, 1, 1);
  return img;
}
