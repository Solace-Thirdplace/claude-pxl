// Node side of the 3D preview: resolves model files, resource-pack references and texture
// names (pxl assets or PNG files), then hands the core loaders what they need.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PxError, wrap } from "../core/errors.ts";
import { Img } from "../core/image.ts";
import type { Model3dDef, Model3dOpts } from "../core/model.ts";
import type { Project } from "../core/project.ts";
import { type JavaResolver, type Model, bbModel, extrudeItem, humanoidModel, javaModel } from "../core/models/index.ts";
import { type RenderOpts, VIEWS, type ViewSheet, bounds, renderViews } from "../core/raster3d.ts";
import { pack as packColor } from "../core/color.ts";
import { decodePng } from "./png.ts";

/** Read a PNG; animated textures (with a .mcmeta beside them) are cut to their first frame. */
export function readTexture(path: string): Img {
  let img: Img;
  try { img = decodePng(readFileSync(path), path); } catch (e) {
    if (e instanceof PxError) throw e;
    throw new PxError(`cannot read texture '${path}'`);
  }
  const meta = path + ".mcmeta";
  if (existsSync(meta)) {
    let fw = img.w, fh = img.w;
    try {
      const a = JSON.parse(readFileSync(meta, "utf8")).animation ?? {};
      if (typeof a.width === "number") fw = (img.w / 16) * a.width;
      if (typeof a.height === "number") fh = (img.w / 16) * a.height;
    } catch { /* malformed mcmeta: assume square frames */ }
    if (fh < img.h) {
      const f = new Img(Math.min(fw, img.w), fh);
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) f.data[y * f.w + x] = img.data[y * img.w + x];
      img = f;
    }
  }
  return img;
}

/** Folders that may hold `<kind>/<path>` for namespace `ns` under a pack or ItemsAdder contents root. */
function candidates(root: string, ns: string, kind: "models" | "textures", path: string, ext: string): string[] {
  const rel = join(kind, path + ext);
  return [
    join(root, "assets", ns, rel),                          // resource pack root
    join(root, ns, rel),                                    // ItemsAdder contents/ or assets/ root
    join(root, ns, "resourcepack", "assets", ns, rel),      // ItemsAdder pack with its own resourcepack/assets
    join(root, ns, "resourcepack", ns, rel),                // ItemsAdder pack with resourcepack/<ns>
    join(root, rel),                                        // root is a namespace folder
  ];
}

export function splitRef(ref: string): [string, string] {
  const i = ref.indexOf(":");
  return i < 0 ? ["minecraft", ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

/** Pack roots implied by where a model file lives (inside assets/ or an ItemsAdder contents/ folder). */
export function impliedPacks(file: string): string[] {
  const out: string[] = [];
  for (let d = dirname(file), prev = ""; d !== prev; prev = d, d = dirname(d)) {
    const base = d.replace(/^.*[\\/]/, "");
    if (base === "assets") out.push(dirname(d));
    if (base === "contents") out.push(d);
  }
  return out;
}

/** Resolve namespaced model and texture references against pack roots; records files it read. */
export function packResolver(roots: string[], files: string[]): JavaResolver {
  const find = (ref: string, kind: "models" | "textures", ext: string): string | undefined => {
    const [ns, path] = splitRef(ref);
    for (const r of roots) for (const c of candidates(r, ns, kind, path, ext)) if (existsSync(c)) return c;
    return undefined;
  };
  return {
    model(ref) {
      const f = find(ref, "models", ".json");
      if (!f) return undefined;
      files.push(f);
      return parseJson(f);
    },
    texture(ref) {
      const f = find(ref, "textures", ".png");
      if (!f) return undefined;
      files.push(f);
      return readTexture(f);
    },
  };
}

function parseJson(f: string): unknown {
  try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) {
    throw new PxError(`cannot parse '${f}': ${(e as Error).message}`);
  }
}

export interface Built3d {
  name: string;
  model: Model;
  /** Files read while building (model, parents, textures), for watching. */
  files: string[];
  turn: number;
  scale?: number;
}

export interface Model3dSources {
  /** Texture by reference: a pxl asset name or a .png path (relative refs resolve from `base`). */
  texture(ref: string): Img;
  /** Base folder for relative paths. */
  base: string;
  files: string[];
}

/** Build a model3d from its options; shared by the art-file declaration and `pxl view3d`. */
export function loadModel3d(name: string, o: Model3dOpts, src: Model3dSources): Built3d {
  const files = src.files;
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(src.base, p));
  const tex = (ref: string | undefined, what: string): Img | undefined => {
    if (ref === undefined) return undefined;
    if (typeof ref !== "string") throw new PxError(`${what} must be a texture name or .png path`);
    return src.texture(ref);
  };
  const textures = Object.fromEntries(Object.entries(o.textures ?? {}).map(([k, v]) => [k, src.texture(v)]));
  const packs = (Array.isArray(o.pack) ? o.pack : o.pack ? [o.pack] : []).map(abs);
  let model: Model;
  if (o.armor) {
    const a = o.armor;
    model = humanoidModel({
      layer1: tex(a.layer1, "armor.layer1"), layer2: tex(a.layer2, "armor.layer2"), pieces: a.pieces,
      skin: a.skin === false ? false : tex(a.skin, "armor.skin"),
    });
    if (!a.layer1 && !a.layer2) model.warnings.push("armor has no layer1 or layer2: showing the bare body");
  } else if (o.item !== undefined) {
    const refs = Array.isArray(o.item) ? o.item : [o.item];
    model = extrudeItem(refs.map((r, i) => tex(r, `item[${i}]`)!));
  } else if (o.java) {
    const f = abs(o.java);
    if (!existsSync(f)) throw new PxError(`model file not found: ${f}`);
    files.push(f);
    model = javaModel(parseJson(f), packResolver([...packs, ...impliedPacks(f)], files), { textures });
  } else if (o.bbmodel) {
    const f = abs(o.bbmodel);
    if (!existsSync(f)) throw new PxError(`Blockbench file not found: ${f}`);
    files.push(f);
    model = bbModel(parseJson(f), { decode: (b, n) => decodePng(b, n), textures });
  } else throw new PxError("model3d needs one of armor, java, bbmodel or item");
  if (!model.quads.length) throw new PxError("model has no visible faces");
  return { name, model, files, turn: o.turn ?? 0, scale: o.scale };
}

/** Build a model3d declared in an art file; texture names may be pxl assets. */
export function buildModel3d(p: Project, def: Model3dDef): Built3d {
  const base = def.file ? dirname(def.file) : process.cwd();
  const files: string[] = [];
  const texture = (ref: string): Img => {
    if (p.assets.has(ref)) return p.image(ref);
    if (/\.png$/i.test(ref)) {
      const f = isAbsolute(ref) ? ref : resolve(base, ref);
      if (!existsSync(f) || !statSync(f).isFile()) throw new PxError(`texture file not found: ${f}`);
      files.push(f);
      return readTexture(f);
    }
    throw new PxError(`unknown texture '${ref}': not an asset in this file or a .png path`);
  };
  try {
    return loadModel3d(def.name, def.opts, { texture, base, files });
  } catch (e) {
    throw wrap(e).within(`model3d '${def.name}'`, def.loc);
  }
}

/** Pixels per model unit that fit the model into about 160px per view. */
export function autoScale(b: Built3d): number {
  const { min, max } = bounds(b.model.quads);
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  return Math.max(2, Math.min(16, Math.round(160 / size)));
}

export const VIEW_BG = packColor(40, 40, 48);

/** The out/_3d sheet: every fixed view, turned so the model's front faces the "front" view. */
export function renderModel3d(b: Built3d, opts: RenderOpts = {}): ViewSheet {
  const views = VIEWS.map((v) => ({ ...v, yaw: v.yaw + b.turn }));
  return renderViews(b.model.quads, views, { scale: b.scale ?? autoScale(b), bg: VIEW_BG, ...opts });
}

