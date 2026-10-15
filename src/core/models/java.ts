// Java Edition block/item model JSON: elements, faces, element rotation, texture variables and
// the parent chain. Generated items (item/generated and friends) become an extruded sprite.
import { PxError } from "../errors.ts";
import type { Img } from "../image.ts";
import { type Face, FACES, type Quad, type UV, type Vec3, faceCorners, rectUV, rotatePoint, rotateUV } from "../raster3d.ts";
import { type Model, missingTexture } from "./common.ts";
import { extrudeItem } from "./extrude.ts";

export interface JavaResolver {
  /** Parsed JSON of a model by resource location ("minecraft:item/handheld"), or undefined. */
  model(ref: string): unknown | undefined;
  /** Texture by resource location ("mypack:item/sword"), or undefined. */
  texture(ref: string): Img | undefined;
}

interface JFace { uv?: number[]; texture?: string; rotation?: number; }
interface JElement {
  from: number[];
  to: number[];
  rotation?: { origin?: number[]; axis?: "x" | "y" | "z"; angle?: number; rescale?: boolean; x?: number; y?: number; z?: number };
  shade?: boolean;
  faces?: Partial<Record<Face, JFace>>;
}
interface JModel { parent?: string; textures?: Record<string, string>; elements?: JElement[]; }

/** Parents that mean "extrude the layerN textures" in vanilla. */
const GENERATED = new Set(["builtin/generated", "item/generated", "item/handheld", "item/handheld_rod", "item/handheld_mace"]);

/** Common vanilla block parents, so block models resolve without the client jar. */
const CUBE: JElement = {
  from: [0, 0, 0], to: [16, 16, 16],
  faces: { down: { texture: "#down" }, up: { texture: "#up" }, north: { texture: "#north" }, south: { texture: "#south" }, west: { texture: "#west" }, east: { texture: "#east" } },
};
const BUILTIN: Record<string, JModel> = {
  "block/block": {},
  "block/cube": { parent: "block/block", elements: [CUBE] },
  "block/cube_all": { parent: "block/cube", textures: { particle: "#all", down: "#all", up: "#all", north: "#all", east: "#all", south: "#all", west: "#all" } },
  "block/cube_column": { parent: "block/cube", textures: { particle: "#side", down: "#end", up: "#end", north: "#side", east: "#side", south: "#side", west: "#side" } },
  "block/cube_bottom_top": { parent: "block/cube", textures: { particle: "#side", down: "#bottom", up: "#top", north: "#side", east: "#side", south: "#side", west: "#side" } },
  "block/orientable": { parent: "block/cube", textures: { particle: "#front", down: "#bottom", up: "#top", north: "#front", east: "#side", south: "#side", west: "#side" } },
};

/** "minecraft:item/x" and "item/x" name the same model. */
export function stripMinecraft(ref: string): string {
  return ref.startsWith("minecraft:") ? ref.slice(10) : ref;
}

/** Default face UV when "uv" is omitted: taken from the element's position (Minecraft's rule). */
function autoUV(f: Vec3, t: Vec3, face: Face): [number, number, number, number] {
  switch (face) {
    case "down": return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case "up": return [f[0], f[2], t[0], t[2]];
    case "north": return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case "south": return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case "west": return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case "east": return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
  }
}

const vec = (a: number[] | undefined, what: string): Vec3 => {
  if (!Array.isArray(a) || a.length !== 3 || a.some((n) => typeof n !== "number")) throw new PxError(`${what} must be [x, y, z]`);
  return [a[0], a[1], a[2]];
};

export interface JavaOpts {
  /** Texture variable overrides ("0" -> Img), applied over the model's own textures. */
  textures?: Record<string, Img>;
}

/** Load a model (already parsed JSON) and everything it inherits. */
export function javaModel(root: unknown, resolve: JavaResolver, opts: JavaOpts = {}): Model {
  const warnings: string[] = [];
  const chain: JModel[] = [];
  let generated = false;
  for (let m = root as JModel | undefined, depth = 0; m; depth++) {
    if (depth > 32) throw new PxError("model parent chain is too deep (a cycle?)");
    if (typeof m !== "object") throw new PxError("model JSON must be an object");
    chain.push(m);
    if (!m.parent) break;
    const ref = stripMinecraft(m.parent);
    if (GENERATED.has(ref)) { generated = true; break; }
    if (ref === "builtin/entity") throw new PxError("builtin/entity models are drawn in code by the game and can't be previewed");
    const next = (resolve.model(m.parent) ?? BUILTIN[ref]) as JModel | undefined;
    if (!next) {
      warnings.push(`parent ${m.parent} not found; using what this model defines`);
      break;
    }
    m = next;
  }

  // Texture variables: nearest definition wins, overrides beat everything.
  const vars: Record<string, string> = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(vars, chain[i].textures ?? {});
  const cache = new Map<string, Img>();
  const missing = missingTexture();
  const texture = (ref: string | undefined, where: string): Img => {
    let r = ref ?? "";
    for (let i = 0; r.startsWith("#") && i < 16; i++) {
      const key = r.slice(1);
      if (opts.textures?.[key]) return opts.textures[key];
      r = vars[key] ?? "";
    }
    if (!r || r.startsWith("#")) {
      warnings.push(`${where}: texture ${ref ?? "(none)"} is not defined`);
      return missing;
    }
    if (!cache.has(r)) {
      const img = resolve.texture(r);
      if (!img) warnings.push(`${where}: texture ${r} not found`);
      cache.set(r, img ?? missing);
    }
    return cache.get(r)!;
  };

  const elements = chain.find((m) => m.elements)?.elements;
  if (!elements) {
    if (!generated) {
      if (chain.length > 1 || warnings.length) warnings.push("model has no elements");
      else throw new PxError("model has no elements and no item/generated parent");
    }
    const layers: Img[] = [];
    for (let i = 0; ("layer" + i) in vars || opts.textures?.["layer" + i]; i++) layers.push(texture("#layer" + i, "layer" + i));
    if (!layers.length) throw new PxError("generated item model has no layer0 texture");
    const m = extrudeItem(layers);
    return { quads: m.quads, warnings };
  }

  const quads: Quad[] = [];
  elements.forEach((el, n) => {
    const where = `elements[${n}]`;
    const f = vec(el.from, `${where}.from`), t = vec(el.to, `${where}.to`);
    const rot = el.rotation;
    const transform = (p: Vec3): Vec3 => {
      if (!rot) return p;
      const origin: Vec3 = rot.origin ? vec(rot.origin, `${where}.rotation.origin`) : [8, 8, 8];
      // Newer models may give x/y/z angles instead of one axis + angle.
      const turns: [("x" | "y" | "z"), number][] = rot.axis ? [[rot.axis, rot.angle ?? 0]] :
        (["x", "y", "z"] as const).filter((a) => rot[a]).map((a) => [a, rot[a]!]);
      for (const [axis, angle] of turns) {
        if (!angle) continue;
        if (rot.rescale) {
          // Stretch the two other axes so a 22.5/45-degree tilt still spans the full block.
          const k = 1 / Math.cos((angle * Math.PI) / 180);
          p = p.map((v, i) => (i === "xyz".indexOf(axis) ? v : origin[i] + (v - origin[i]) * k)) as Vec3;
        }
        p = rotatePoint(p, origin, axis, angle);
      }
      return p;
    };
    for (const face of FACES) {
      const jf = el.faces?.[face];
      if (!jf) continue;
      const tex = texture(jf.texture, `${where}.faces.${face}`);
      const r = (jf.uv ?? autoUV(f, t, face)) as [number, number, number, number];
      const uv = rotateUV(rectUV(r), jf.rotation ?? 0).map(([u, v]) => [(u * tex.w) / 16, (v * tex.h) / 16]) as [UV, UV, UV, UV];
      const p = faceCorners(f, t, face).map(transform) as Quad["p"];
      quads.push({ p, uv, tex, shade: el.shade !== false });
    }
  });
  return { quads, warnings };
}
