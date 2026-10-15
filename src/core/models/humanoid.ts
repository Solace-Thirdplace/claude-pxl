// Vanilla humanoid (player) model wearing armour, in pxl model space (y up, feet at 0, front +z).
// Geometry follows HumanoidModel / HumanoidArmorModel; entity coordinates (y down, front -z) are
// turned 180 degrees about x: (x, y, z) -> (x, 24 - y, -z).
import { PxError } from "../errors.ts";
import { pack } from "../color.ts";
import { Img } from "../image.ts";
import type { Quad, Vec3 } from "../raster3d.ts";
import { type Model, boxQuads, boxUV } from "./common.ts";

type Part = "head" | "hat" | "body" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";

interface PartDef {
  from: Vec3;
  size: Vec3;
  uv: [number, number];
  /** UV of the left limb on 64x64 skins (64x32 textures mirror the right limb instead). */
  uv64?: [number, number];
  /** Skin overlay layer UV on 64x64 skins. */
  overlay?: [number, number];
}

const PARTS: Record<Part, PartDef> = {
  head: { from: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
  hat: { from: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0] },
  body: { from: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], overlay: [16, 32] },
  rightArm: { from: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16], overlay: [40, 32] },
  leftArm: { from: [4, 12, -2], size: [4, 12, 4], uv: [40, 16], uv64: [32, 48], overlay: [48, 48] },
  rightLeg: { from: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16], overlay: [0, 32] },
  leftLeg: { from: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 16], uv64: [16, 48], overlay: [0, 48] },
};

export type ArmorPiece = "helmet" | "chestplate" | "leggings" | "boots";

/** Parts each piece shows, which texture layer it reads, and its inflation (HumanoidArmorModel). */
const PIECES: Record<ArmorPiece, { layer: 1 | 2; parts: Part[] }> = {
  helmet: { layer: 1, parts: ["head", "hat"] },
  chestplate: { layer: 1, parts: ["body", "rightArm", "leftArm"] },
  leggings: { layer: 2, parts: ["body", "rightLeg", "leftLeg"] },
  boots: { layer: 1, parts: ["rightLeg", "leftLeg"] },
};

function inflation(layer: 1 | 2, part: Part): number {
  const base = layer === 1 ? 1 : 0.5;
  if (part === "hat") return base + 0.5;
  if (part === "rightLeg" || part === "leftLeg") return base - 0.1;
  return base;
}

function partQuads(part: Part, tex: Img, inflate: number, cull: boolean, opts: { skin64?: boolean; overlay?: boolean } = {}): Quad[] {
  const d = PARTS[part];
  const left = part === "leftArm" || part === "leftLeg";
  const uv = opts.overlay ? d.overlay! : opts.skin64 && d.uv64 ? d.uv64 : d.uv;
  const texScale: [number, number] = [tex.w / 64, tex.h / (opts.skin64 ? 64 : 32)];
  return boxQuads({ uv, size: d.size, from: d.from, inflate, mirror: left && !(opts.skin64 && d.uv64), tex, texScale, cull });
}

/** Flat-colour stand-in figure so armour is seen on a body without shipping a Mojang skin. */
export function mannequinSkin(): Img {
  const skin = new Img(64, 32);
  const fill = (r: [number, number][][], c: number) => {
    for (const [[u0, v0], , [u1, v1]] of r)
      for (let y = Math.min(v0, v1); y < Math.max(v0, v1); y++)
        for (let x = Math.min(u0, u1); x < Math.max(u0, u1); x++) skin.set(x, y, c);
  };
  const faces = (p: PartDef) => Object.values(boxUV(p.uv[0], p.uv[1], p.size[0], p.size[1], p.size[2]));
  const tone = pack(176, 160, 146), cloth = pack(92, 98, 112), dark = pack(64, 68, 80);
  fill(faces(PARTS.head), tone);
  fill(faces(PARTS.rightArm), tone);
  fill(faces(PARTS.body), cloth);
  fill(faces(PARTS.rightLeg), dark);
  // a face: two eyes, so front and back are told apart
  skin.set(10, 12, dark);
  skin.set(13, 12, dark);
  return skin;
}

export interface HumanoidOpts {
  /** Armour textures (64x32 layout, any multiple of that size). */
  layer1?: Img;
  layer2?: Img;
  /** Which pieces to wear (default: every piece whose layer texture is given). */
  pieces?: ArmorPiece[];
  /** Body texture: a 64x64 or 64x32 skin; default the built-in mannequin. `false` hides the body. */
  skin?: Img | false;
}

export function humanoidModel(o: HumanoidOpts): Model {
  const quads: Quad[] = [];
  if (o.skin !== false) {
    const skin = o.skin ?? mannequinSkin();
    const skin64 = skin.h === skin.w;
    if (!skin64 && skin.w !== skin.h * 2) throw new PxError(`skin must be 64x64 or 64x32 (any scale), got ${skin.w}x${skin.h}`);
    for (const part of ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"] as Part[]) quads.push(...partQuads(part, skin, 0, true, { skin64 }));
    quads.push(...partQuads("hat", skin, 0.5, false, { skin64 }));
    if (skin64)
      for (const part of ["body", "rightArm", "leftArm", "rightLeg", "leftLeg"] as Part[]) quads.push(...partQuads(part, skin, 0.25, false, { skin64, overlay: true }));
  }
  const pieces = o.pieces ?? (Object.keys(PIECES) as ArmorPiece[]).filter((p) => (PIECES[p].layer === 1 ? o.layer1 : o.layer2));
  for (const piece of pieces) {
    const { layer, parts } = PIECES[piece];
    const tex = layer === 1 ? o.layer1 : o.layer2;
    if (!tex) throw new PxError(`${piece} needs layer${layer}`);
    if (tex.w !== tex.h * 2) throw new PxError(`armour layer${layer} must be 64x32 (any scale), got ${tex.w}x${tex.h}`);
    for (const part of parts) quads.push(...partQuads(part, tex, inflation(layer, part), false));
  }
  return { quads, warnings: [] };
}
