// Blockbench project files (.bbmodel): cubes with per-face UVs, element and group (bone)
// rotations around their pivots, and textures embedded as data URLs.
import { PxError } from "../errors.ts";
import type { Img } from "../image.ts";
import { type Face, FACES, type Quad, type UV, type Vec3, faceCorners, rectUV, rotateUV } from "../raster3d.ts";
import { type Model, eulerRotate, missingTexture } from "./common.ts";

interface BBFace { uv?: number[]; texture?: number | string | null | false; rotation?: number; }
interface BBElement {
  uuid: string;
  name?: string;
  type?: string;
  from?: number[];
  to?: number[];
  origin?: number[];
  rotation?: number[];
  inflate?: number;
  visibility?: boolean;
  export?: boolean;
  faces?: Partial<Record<Face, BBFace>>;
}
interface BBGroup { uuid?: string; name?: string; origin?: number[]; rotation?: number[]; visibility?: boolean; export?: boolean; children?: (string | BBGroup)[]; }
interface BBTexture { uuid?: string; id?: string; name?: string; source?: string; uv_width?: number; uv_height?: number; }
interface BBFile {
  meta?: { model_format?: string };
  resolution?: { width?: number; height?: number };
  elements?: BBElement[];
  outliner?: (string | BBGroup)[];
  textures?: BBTexture[];
}

export interface BBOpts {
  /** Decode an embedded texture (PNG bytes). */
  decode: (bytes: Uint8Array, name: string) => Img;
  /** Replace textures by name, id or index ("0", "skin", ...). */
  textures?: Record<string, Img>;
}

const v3 = (a: number[] | undefined, d: Vec3 = [0, 0, 0]): Vec3 => (Array.isArray(a) && a.length >= 3 ? [a[0], a[1], a[2]] : d);

function dataUrlBytes(src: string): Uint8Array | undefined {
  const m = /^data:image\/png;base64,(.*)$/s.exec(src);
  if (!m) return undefined;
  const bin = atob(m[1].replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bbModel(json: unknown, opts: BBOpts): Model {
  const f = json as BBFile;
  if (!f || typeof f !== "object" || !Array.isArray(f.elements)) throw new PxError("not a Blockbench model (no elements array)");
  const warnings: string[] = [];
  const resW = f.resolution?.width ?? 16, resH = f.resolution?.height ?? 16;

  // Textures, addressable by index, uuid, id and name.
  const missing = missingTexture();
  const texList = (f.textures ?? []).map((t, i) => {
    const override = opts.textures?.[String(i)] ?? (t.name ? opts.textures?.[t.name] ?? opts.textures?.[t.name.replace(/\.png$/, "")] : undefined) ?? (t.id ? opts.textures?.[t.id] : undefined);
    let img = override;
    if (!img && t.source) {
      const bytes = dataUrlBytes(t.source);
      if (bytes) img = opts.decode(bytes, t.name ?? `texture ${i}`);
    }
    if (!img) warnings.push(`texture ${t.name ?? i} has no embedded image; pass it with textures`);
    return { t, img: img ?? missing, uvW: t.uv_width ?? resW, uvH: t.uv_height ?? resH };
  });
  const textureOf = (ref: BBFace["texture"]) => {
    if (ref === null || ref === false || ref === undefined) return undefined;
    if (typeof ref === "number") return texList[ref];
    return texList.find((x) => x.t.uuid === ref || x.t.id === ref);
  };

  // Each element's ancestors (innermost first), from the outliner tree.
  const parents = new Map<string, BBGroup[]>();
  const hidden = new Set<string>();
  const walk = (nodes: (string | BBGroup)[] | undefined, chain: BBGroup[], off: boolean) => {
    for (const n of nodes ?? []) {
      if (typeof n === "string") {
        parents.set(n, chain);
        if (off) hidden.add(n);
      } else walk(n.children, [n, ...chain], off || n.visibility === false || n.export === false);
    }
  };
  walk(f.outliner, [], false);

  const quads: Quad[] = [];
  let meshes = 0;
  for (const el of f.elements) {
    if (el.type && el.type !== "cube") {
      if (el.type === "mesh") meshes++;
      continue;
    }
    if (el.visibility === false || el.export === false || hidden.has(el.uuid)) continue;
    const g = el.inflate ?? 0;
    const a = v3(el.from), b = v3(el.to);
    const lo: Vec3 = [Math.min(a[0], b[0]) - g, Math.min(a[1], b[1]) - g, Math.min(a[2], b[2]) - g];
    const hi: Vec3 = [Math.max(a[0], b[0]) + g, Math.max(a[1], b[1]) + g, Math.max(a[2], b[2]) + g];
    const chain = parents.get(el.uuid) ?? [];
    const transform = (p: Vec3): Vec3 => {
      p = eulerRotate(p, v3(el.origin), el.rotation ? v3(el.rotation) : undefined);
      for (const grp of chain) p = eulerRotate(p, v3(grp.origin), grp.rotation ? v3(grp.rotation) : undefined);
      return p;
    };
    for (const face of FACES) {
      const bf = el.faces?.[face];
      if (!bf?.uv) continue;
      const tx = textureOf(bf.texture);
      if (!tx) continue;
      const su = tx.img.w / tx.uvW, sv = tx.img.h / tx.uvH;
      const uv = rotateUV(rectUV(bf.uv as [number, number, number, number]), bf.rotation ?? 0)
        .map(([u, v]) => [u * su, v * sv]) as [UV, UV, UV, UV];
      quads.push({ p: faceCorners(lo, hi, face).map(transform) as Quad["p"], uv, tex: tx.img });
    }
  }
  if (meshes) warnings.push(`${meshes} mesh element(s) skipped (only cubes are supported)`);
  return { quads, warnings };
}
