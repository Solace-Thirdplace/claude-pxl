// Shared pieces for the 3D model loaders: box-UV layout and quad transforms.
import { Img } from "../image.ts";
import { type Quad, type UV, type Vec3, faceCorners, rectUV, rotatePoint } from "../raster3d.ts";

/** A loaded model: quads ready for the rasterizer, plus notes about anything it skipped. */
export interface Model {
  quads: Quad[];
  warnings: string[];
}

/**
 * Faces of a box laid out in Minecraft's entity/skin "box UV" format at (u, v) for a box of
 * w x h x d texels. Model space is pxl's (y up, front +z): right side = -x, left side = +x.
 *
 *   u:      u      u+d      u+d+w    u+2d+w   u+2d+2w
 *   v:      .      top      bottom   .
 *   v+d:    right  front    left     back
 */
export function boxUV(u: number, v: number, w: number, h: number, d: number) {
  return {
    up: rectUV([u + d, v, u + d + w, v + d]),
    // The skin's bottom face is stored with the back edge on top (it is flipped vs. "down").
    down: rectUV([u + d + w, v + d, u + d + 2 * w, v]),
    west: rectUV([u, v + d, u + d, v + d + h]),
    south: rectUV([u + d, v + d, u + d + w, v + d + h]),
    east: rectUV([u + d + w, v + d, u + 2 * d + w, v + d + h]),
    north: rectUV([u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]),
  };
}

export interface BoxOpts {
  /** Texel offset of the box UV layout. */
  uv: [number, number];
  /** Box size in texels (also its size in model units before inflation). */
  size: Vec3;
  /** Min corner in model units (y up, front +z). */
  from: Vec3;
  /** Grow every side by this much (armour layers: 1.0 outer, 0.5 inner). */
  inflate?: number;
  /** Mirror the texture across x (left limbs on 64x32 textures). */
  mirror?: boolean;
  tex: Img;
  /** Texels per UV unit when the UV layout is drawn at a different size than the texture (default 1). */
  texScale?: [number, number];
  cull?: boolean;
}

/** Six quads of a box-UV cube. */
export function boxQuads(o: BoxOpts): Quad[] {
  const [w, h, d] = o.size, g = o.inflate ?? 0;
  const a: Vec3 = [o.from[0] - g, o.from[1] - g, o.from[2] - g];
  const b: Vec3 = [o.from[0] + w + g, o.from[1] + h + g, o.from[2] + d + g];
  const uvs = boxUV(o.uv[0], o.uv[1], w, h, d);
  const [su, sv] = o.texScale ?? [1, 1];
  const quads: Quad[] = (Object.keys(uvs) as (keyof typeof uvs)[]).map((f) => ({
    p: faceCorners(a, b, f),
    uv: uvs[f].map(([x, y]) => [x * su, y * sv]) as [UV, UV, UV, UV],
    tex: o.tex,
    cull: o.cull,
  }));
  return o.mirror ? quads.map((q) => mirrorX(q, (a[0] + b[0]) / 2)) : quads;
}

/** Mirror a quad across the plane x = cx, keeping it facing outward (the texture mirrors with it). */
export function mirrorX(q: Quad, cx: number): Quad {
  const m = (p: Vec3): Vec3 => [2 * cx - p[0], p[1], p[2]];
  return { ...q, p: [m(q.p[1]), m(q.p[0]), m(q.p[3]), m(q.p[2])], uv: [q.uv[1], q.uv[0], q.uv[3], q.uv[2]] };
}

export function mapPoints(q: Quad, f: (p: Vec3) => Vec3): Quad {
  return { ...q, p: q.p.map(f) as Quad["p"] };
}

/** Rotate by Euler angles in degrees around `origin`, X first, then Y, then Z (Blockbench's order). */
export function eulerRotate(p: Vec3, origin: Vec3, r: Vec3 | undefined): Vec3 {
  if (!r) return p;
  if (r[0]) p = rotatePoint(p, origin, "x", r[0]);
  if (r[1]) p = rotatePoint(p, origin, "y", r[1]);
  if (r[2]) p = rotatePoint(p, origin, "z", r[2]);
  return p;
}

/** Placeholder texture for faces whose texture is missing: magenta/black checker, like the game. */
export function missingTexture(): Img {
  const t = new Img(2, 2);
  t.data.set([0xf800f8ff, 0x000000ff, 0x000000ff, 0xf800f8ff]);
  return t;
}
