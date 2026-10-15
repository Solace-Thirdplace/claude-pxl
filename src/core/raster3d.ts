// Software rasterizer for previewing textures on 3D models: textured quads, orthographic camera,
// z-buffer, nearest-texel sampling. Shared by the PNG output and the browser viewer.
//
// Model space is Minecraft's: x east, y up, z south, units = model pixels (1/16 block). A model's
// front faces +z, so the default camera (yaw 0, pitch 0) sits south of it and looks north.
import { type Color, TRANSPARENT, channels, pack } from "./color.ts";
import { glyph } from "./font.ts";
import { Img } from "./image.ts";

export type Vec3 = [number, number, number];
export type UV = [number, number];

/**
 * One textured quad. `p[i]` shows texel coordinate `uv[i]` (texture pixels, may be fractional).
 * Corners go top-left, top-right, bottom-right, bottom-left as seen from the face's front side.
 */
export interface Quad {
  p: [Vec3, Vec3, Vec3, Vec3];
  uv: [UV, UV, UV, UV];
  tex: Img;
  /** Hide the quad when seen from behind (default true). Minecraft armour renders both sides. */
  cull?: boolean;
  /** Apply directional face shading (default true). */
  shade?: boolean;
}

export interface Camera {
  /** Degrees around the vertical axis: 0 = camera south of the model, 90 = east, 180 = north. */
  yaw: number;
  /** Degrees above the horizon: 90 = straight down from the top. */
  pitch: number;
}

export interface View extends Camera {
  name: string;
}

/** The fixed angles written to PNG: four sides, top, and two 3/4 views that show the seams. */
export const VIEWS: View[] = [
  { name: "front", yaw: 0, pitch: 0 },
  { name: "right", yaw: 270, pitch: 0 },
  { name: "back", yaw: 180, pitch: 0 },
  { name: "left", yaw: 90, pitch: 0 },
  { name: "top", yaw: 0, pitch: 90 },
  { name: "3/4 front", yaw: 35, pitch: 25 },
  { name: "3/4 back", yaw: 215, pitch: 25 },
];

export interface RenderOpts {
  /** Screen pixels per model unit (default 8). */
  scale?: number;
  /** Output size; default fits the model's bounding sphere so every angle gets the same frame. */
  w?: number;
  h?: number;
  /** Model point drawn at the image center (default: center of the quads' bounds). */
  center?: Vec3;
  bg?: Color;
}

const RAD = Math.PI / 180;

/** View transform: camera space x right, y up, z toward the camera. */
export function viewMatrix(cam: Camera): (p: Vec3) => Vec3 {
  const cy = Math.cos(cam.yaw * RAD), sy = Math.sin(cam.yaw * RAD);
  const cp = Math.cos(cam.pitch * RAD), sp = Math.sin(cam.pitch * RAD);
  return ([x, y, z]) => {
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
}

export function bounds(quads: Quad[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const q of quads)
    for (const p of q.p)
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
  if (!quads.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Outward normal (unit) of a quad, from its corner order. */
export function quadNormal(q: Quad): Vec3 {
  const n = cross(sub(q.p[3], q.p[0]), sub(q.p[1], q.p[0]));
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Minecraft-style face brightness: up 1, down 0.5, north/south 0.8, east/west 0.6, blended by normal. */
export function faceShade(n: Vec3): number {
  return n[0] * n[0] * 0.6 + n[1] * n[1] * (n[1] > 0 ? 1 : 0.5) + n[2] * n[2] * 0.8;
}

function shadeColor(c: Color, k: number): Color {
  if (k >= 0.999) return c;
  const [r, g, b, a] = channels(c);
  return pack(Math.round(r * k), Math.round(g * k), Math.round(b * k), a);
}

function blend(dst: Color, src: Color): Color {
  const [r, g, b, a] = channels(src);
  if (dst === TRANSPARENT) return src;
  const [dr, dg, db, da] = channels(dst);
  const t = a / 255, oa = a + da * (1 - t);
  return pack(Math.round(r * t + dr * (1 - t)), Math.round(g * t + dg * (1 - t)), Math.round(b * t + db * (1 - t)), Math.round(oa));
}

/** Render quads from one camera. Opaque texels first (z-buffered), then translucent ones back to front. */
export function render(quads: Quad[], cam: Camera, opts: RenderOpts = {}): Img {
  const scale = opts.scale ?? 8;
  const { min, max } = bounds(quads);
  const center = opts.center ?? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const w = opts.w ?? Math.ceil(radius * 2 * scale) + 2, h = opts.h ?? w;
  const img = new Img(w, h);
  if (opts.bg) img.fill(opts.bg);
  const zbuf = new Float32Array(w * h).fill(-Infinity);
  const view = viewMatrix(cam);
  const toScreen = (p: Vec3): Vec3 => {
    const v = view(sub(p, center));
    return [w / 2 + v[0] * scale, h / 2 - v[1] * scale, v[2]];
  };

  interface Prep { s: Vec3[]; q: Quad; k: number; depth: number }
  const prep: Prep[] = [];
  for (const q of quads) {
    const s = q.p.map(toScreen);
    // Screen-space winding: front faces are clockwise on screen (y down) with this corner order.
    const area = (s[1][0] - s[0][0]) * (s[3][1] - s[0][1]) - (s[3][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    if (area < 0 && q.cull !== false) continue;
    const k = q.shade === false ? 1 : faceShade(quadNormal(q));
    prep.push({ s, q, k, depth: (s[0][2] + s[1][2] + s[2][2] + s[3][2]) / 4 });
  }

  const translucent: { i: number; c: Color; z: number; d: number }[] = [];
  // Pixels on a quad's diagonal fall in both of its triangles; draw each pixel once per quad.
  const seen = new Int32Array(w * h);
  let qid = 0;
  for (const { s, q, k, depth } of prep) {
    qid++;
    const umin = Math.min(...q.uv.map((t) => t[0])), umax = Math.max(...q.uv.map((t) => t[0]));
    const vmin = Math.min(...q.uv.map((t) => t[1])), vmax = Math.max(...q.uv.map((t) => t[1]));
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const A = s[a], B = s[b], C = s[c];
      const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
      const ua = q.uv[a], ub = q.uv[b], uc = q.uv[c];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l0 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den;
          const l1 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
          const l2 = 1 - l0 - l1;
          const e = -1e-6;
          if (l0 < e || l1 < e || l2 < e) continue;
          const z = l0 * A[2] + l1 * B[2] + l2 * C[2];
          const i = y * w + x;
          if (z <= zbuf[i] || seen[i] === qid) continue;
          seen[i] = qid;
          // Clamp inside the face's texel rectangle so edge pixels never sample a neighbouring face.
          const u = Math.min(Math.max(l0 * ua[0] + l1 * ub[0] + l2 * uc[0], umin), umax - 1e-4);
          const v = Math.min(Math.max(l0 * ua[1] + l1 * ub[1] + l2 * uc[1], vmin), vmax - 1e-4);
          const col = q.tex.get(Math.floor(u), Math.floor(v));
          const alpha = col & 255;
          if (alpha === 0) continue;
          const shaded = shadeColor(col, k);
          if (alpha === 255) {
            zbuf[i] = z;
            img.data[i] = shaded;
          } else translucent.push({ i, c: shaded, z, d: depth });
        }
    }
  }
  translucent.sort((a, b) => a.d - b.d || a.z - b.z);
  for (const t of translucent) if (t.z > zbuf[t.i]) img.data[t.i] = blend(img.data[t.i], t.c);
  return img;
}

export interface ViewSheet {
  img: Img;
  views: { name: string; x: number; y: number; w: number; h: number }[];
}

/** Render several views side by side (same scale and frame), each labelled underneath. */
export function renderViews(quads: Quad[], views: View[] = VIEWS, opts: RenderOpts & { label?: Color; cols?: number } = {}): ViewSheet {
  const shots = views.map((v) => ({ v, img: render(quads, v, opts) }));
  const cw = Math.max(...shots.map((s) => s.img.w)), ch = Math.max(...shots.map((s) => s.img.h));
  const cols = Math.min(opts.cols ?? shots.length, shots.length), rows = Math.ceil(shots.length / cols);
  const pad = 4, labelH = 9;
  const sheet = new Img(cols * (cw + pad) + pad, rows * (ch + labelH + pad) + pad);
  if (opts.bg) sheet.fill(opts.bg);
  const ink = opts.label ?? pack(150, 150, 160);
  const out: ViewSheet["views"] = [];
  shots.forEach(({ v, img }, n) => {
    const x = pad + (n % cols) * (cw + pad), y = pad + Math.floor(n / cols) * (ch + labelH + pad);
    sheet.blit(img, x, y);
    out.push({ name: v.name, x, y, w: img.w, h: img.h });
    drawLabel(sheet, v.name, x + Math.floor(cw / 2), y + ch + 2, ink);
  });
  return { img: sheet, views: out };
}

function drawLabel(img: Img, text: string, cx: number, y: number, c: Color): void {
  const glyphs = [...text].map((ch) => glyph(ch));
  const width = glyphs.reduce((s, g) => s + (g[0]?.length ?? 0) + 1, -1);
  let x = cx - Math.floor(width / 2);
  for (const g of glyphs) {
    g.forEach((row, gy) => [...row].forEach((ch, gx) => ch === "#" && img.set(x + gx, y + gy, c)));
    x += (g[0]?.length ?? 0) + 1;
  }
}

/** An axis-aligned box face list helper: 6 faces of [from, to], each mapped by `uvOf(face)`. */
export type Face = "north" | "south" | "east" | "west" | "up" | "down";
export const FACES: Face[] = ["north", "south", "east", "west", "up", "down"];

/**
 * Corners of one face of the box [a, b], ordered top-left, top-right, bottom-right, bottom-left as
 * seen from outside, with Minecraft's texture orientation (up/down faces have north at the top).
 */
export function faceCorners(a: Vec3, b: Vec3, face: Face): [Vec3, Vec3, Vec3, Vec3] {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  switch (face) {
    case "south": return [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]];
    case "north": return [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]];
    case "east": return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]];
    case "west": return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]];
    case "up": return [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    case "down": return [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]];
  }
}

/** UV rectangle [u0, v0, u1, v1] to the 4 corner UVs (u1 < u0 or v1 < v0 mirror the face). */
export function rectUV(r: [number, number, number, number]): [UV, UV, UV, UV] {
  const [u0, v0, u1, v1] = r;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

/** Rotate a quad's UV corners by 0/90/180/270 degrees clockwise (Minecraft face `rotation`). */
export function rotateUV(uv: [UV, UV, UV, UV], deg: number): [UV, UV, UV, UV] {
  const n = (((Math.round(deg / 90) % 4) + 4) % 4);
  return [0, 1, 2, 3].map((i) => uv[(i + 4 - n) % 4]) as [UV, UV, UV, UV];
}

/** Rotate points around `origin` by `deg` about one axis (right-handed, like Minecraft element rotation). */
export function rotatePoint(p: Vec3, origin: Vec3, axis: "x" | "y" | "z", deg: number): Vec3 {
  const r = deg * RAD, c = Math.cos(r), s = Math.sin(r);
  const [x, y, z] = sub(p, origin);
  let o: Vec3;
  if (axis === "x") o = [x, y * c - z * s, y * s + z * c];
  else if (axis === "y") o = [x * c + z * s, y, -x * s + z * c];
  else o = [x * c - y * s, x * s + y * c, z];
  return [o[0] + origin[0], o[1] + origin[1], o[2] + origin[2]];
}
