import { test } from "node:test";
import assert from "node:assert/strict";
import { TRANSPARENT, pack } from "../src/core/color.ts";
import { Img } from "../src/core/image.ts";
import { type Camera, type Quad, render } from "../src/core/raster3d.ts";
import { boxUV, humanoidModel, extrudeItem, javaModel, bbModel } from "../src/core/models/index.ts";
import { decodePng, encodePng } from "../src/node/png.ts";

const FRONT: Camera = { yaw: 0, pitch: 0 }, BACK: Camera = { yaw: 180, pitch: 0 };
const RIGHT_SIDE: Camera = { yaw: 270, pitch: 0 }, LEFT_SIDE: Camera = { yaw: 90, pitch: 0 };
const TOP: Camera = { yaw: 0, pitch: 90 }, BOTTOM: Camera = { yaw: 0, pitch: -90 };

const COLORS = { up: pack(255, 0, 0), down: pack(0, 255, 0), west: pack(0, 0, 255), south: pack(255, 255, 0), east: pack(0, 255, 255), north: pack(255, 0, 255) };

/** 64x32 texture with each face of the box-UV box at (u, v) filled with its own color. */
function faceColored(u: number, v: number, w: number, h: number, d: number, tex = new Img(64, 32)): Img {
  const uvs = boxUV(u, v, w, h, d);
  for (const [face, uv] of Object.entries(uvs)) {
    const xs = uv.map((p) => p[0]), ys = uv.map((p) => p[1]);
    for (let y = Math.min(...ys); y < Math.max(...ys); y++)
      for (let x = Math.min(...xs); x < Math.max(...xs); x++) tex.set(x, y, COLORS[face as keyof typeof COLORS]);
  }
  return tex;
}

function at(quads: Quad[], cam: Camera, x: number, y: number, scale = 4): number {
  const img = render(quads, cam, { scale });
  return img.get(Math.floor(img.w * x), Math.floor(img.h * y));
}

const unshaded = (qs: Quad[]) => qs.map((q) => ({ ...q, shade: false }));

test("humanoid: each helmet face shows its skin-layout region from the matching side", () => {
  const tex = faceColored(0, 0, 8, 8, 8);
  const q = unshaded(humanoidModel({ layer1: tex, pieces: ["helmet"], skin: false }).quads);
  assert.equal(at(q, FRONT, 0.5, 0.5), COLORS.south, "front = (8,8)");
  assert.equal(at(q, BACK, 0.5, 0.5), COLORS.north, "back = (24,8)");
  assert.equal(at(q, RIGHT_SIDE, 0.5, 0.5), COLORS.west, "wearer's right = (0,8)");
  assert.equal(at(q, LEFT_SIDE, 0.5, 0.5), COLORS.east, "wearer's left = (16,8)");
  assert.equal(at(q, TOP, 0.5, 0.5), COLORS.up, "top = (8,0)");
  assert.equal(at(q, BOTTOM, 0.5, 0.5), COLORS.down, "bottom = (16,0)");
});

test("humanoid: top and bottom faces keep the back edge on the texture's top row", () => {
  const tex = new Img(64, 32);
  for (let x = 8; x < 16; x++) tex.set(x, 0, pack(255, 0, 0)); // top face, first row
  for (let x = 16; x < 24; x++) tex.set(x, 0, pack(0, 255, 0)); // bottom face, first row
  const q = unshaded(humanoidModel({ layer1: tex, pieces: ["helmet"], skin: false }).quads);
  // From above with north (the back) at the top of the screen, row 0 is the far edge.
  const top = render(q, TOP, { scale: 4 });
  const rows = (img: Img, c: number) => [...Array(img.h).keys()].filter((y) => [...Array(img.w).keys()].some((x) => img.get(x, y) === c));
  const redRows = rows(top, pack(255, 0, 0));
  assert.ok(redRows.length && Math.max(...redRows) < top.h / 2, "top face: back edge drawn at the top");
  // From below, the camera's screen-up is south (the front), so the back edge lands at the bottom.
  const bottom = render(q, BOTTOM, { scale: 4 });
  const greenRows = rows(bottom, pack(0, 255, 0));
  assert.ok(greenRows.length && Math.min(...greenRows) > bottom.h / 2, "bottom face: back edge drawn away from the front");
});

test("humanoid: left limbs mirror the right limb's texture; outer sides show the outer region", () => {
  const tex = faceColored(40, 16, 4, 12, 4);
  const q = unshaded(humanoidModel({ layer1: tex, pieces: ["chestplate"], skin: false }).quads);
  // Wearer's right arm, seen from the right: its outer (west) face.
  assert.equal(at(q, RIGHT_SIDE, 0.5, 0.55), COLORS.west);
  // Wearer's left arm, seen from the left: the mirrored box puts the same outer region on +x.
  assert.equal(at(q, LEFT_SIDE, 0.5, 0.55), COLORS.west);
});

test("humanoid: armour layers render with inflation over the mannequin and reject bad sizes", () => {
  const plain = new Img(64, 32).fill(pack(200, 200, 200));
  const m = humanoidModel({ layer1: plain, layer2: plain });
  const ys = m.quads.flatMap((q) => q.p.map((p) => p[1]));
  assert.equal(Math.max(...ys), 33.5); // helmet hat layer: 32 + 1.5
  assert.throws(() => humanoidModel({ layer1: new Img(16, 16) }), /64x32/);
});

test("extrude: the sprite reads correctly from the front, mirrored from the back, with edge walls", () => {
  const s = new Img(2, 2);
  s.set(0, 0, pack(255, 0, 0));
  s.set(1, 1, pack(0, 0, 255));
  const q = unshaded(extrudeItem([s]).quads);
  const f = render(q, FRONT, { scale: 1, w: 16, h: 16, center: [8, 8, 8] });
  assert.equal(f.get(2, 2), pack(255, 0, 0));
  assert.equal(f.get(12, 12), pack(0, 0, 255));
  const b = render(q, BACK, { scale: 1, w: 16, h: 16, center: [8, 8, 8] });
  assert.equal(b.get(12, 2), pack(255, 0, 0));
  assert.equal(q.length, 2 + 8); // front, back, four walls around each lone pixel
});

function solid(c: number, w = 16, h = 16): Img {
  return new Img(w, h).fill(c);
}

test("java: elements, auto UV, texture variables through parents, and the generated fallback", () => {
  const red = solid(pack(255, 0, 0)), blue = solid(pack(0, 0, 255));
  const models: Record<string, unknown> = {
    "pack:block/base": { textures: { side: "#all" }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { south: { texture: "#side" }, up: { texture: "#top" } } }] },
  };
  const textures: Record<string, Img> = { "pack:block/red": red, "pack:block/blue": blue };
  const resolve = { model: (r: string) => models[r], texture: (r: string) => textures[r] };
  const m = javaModel({ parent: "pack:block/base", textures: { all: "pack:block/red", top: "pack:block/blue" } }, resolve);
  assert.deepEqual(m.warnings, []);
  const q = unshaded(m.quads);
  assert.equal(at(q, FRONT, 0.5, 0.5), pack(255, 0, 0));
  assert.equal(at(q, TOP, 0.5, 0.5), pack(0, 0, 255));
  const gen = javaModel({ parent: "minecraft:item/handheld", textures: { layer0: "pack:block/red" } }, resolve);
  assert.ok(gen.quads.length >= 2);
  const miss = javaModel({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { south: { texture: "#nope" } } }] }, resolve);
  assert.match(miss.warnings[0], /#nope is not defined/);
});

test("java: element rotation turns geometry around its origin; explicit uv and face rotation map texels", () => {
  const tex = new Img(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) tex.set(x, y, x < 8 ? pack(255, 0, 0) : pack(0, 0, 255));
  const resolve = { model: () => undefined, texture: () => tex };
  const flat = { textures: { t: "p:t" }, elements: [{ from: [0, 0, 8], to: [16, 16, 8], faces: { south: { texture: "#t", uv: [0, 0, 16, 16] } } }] };
  const q0 = unshaded(javaModel(flat, resolve).quads);
  assert.equal(at(q0, FRONT, 0.3, 0.5, 2), pack(255, 0, 0));
  // 180 degrees about y: now faces north, so only the back camera sees it, still reading left to right
  const turned = { ...flat, elements: [{ ...flat.elements[0], rotation: { origin: [8, 8, 8], axis: "y", angle: 180 } }] };
  const q1 = unshaded(javaModel(turned, resolve).quads);
  assert.equal(at(q1, FRONT, 0.5, 0.5, 2), TRANSPARENT);
  assert.equal(at(q1, BACK, 0.3, 0.5, 2), pack(255, 0, 0));
  // face rotation 180 swaps left and right halves
  const spun = { ...flat, elements: [{ ...flat.elements[0], faces: { south: { texture: "#t", uv: [0, 0, 16, 16], rotation: 180 } } }] };
  assert.equal(at(unshaded(javaModel(spun, resolve).quads), FRONT, 0.3, 0.5, 2), pack(0, 0, 255));
});

test("bbmodel: embedded textures, face UVs in project pixels, and group rotation", () => {
  const tex = new Img(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) tex.set(x, y, x < 16 ? pack(255, 0, 0) : pack(0, 0, 255));
  const src = "data:image/png;base64," + Buffer.from(encodePng(tex)).toString("base64");
  const file = (rotation?: number[]) => ({
    meta: { model_format: "free" },
    resolution: { width: 16, height: 16 },
    textures: [{ name: "skin", uuid: "t1", source: src }],
    elements: [{ uuid: "e1", type: "cube", from: [0, 0, 0], to: [4, 4, 4], origin: [2, 2, 2], faces: {
      south: { uv: [0, 0, 8, 8], texture: 0 }, west: { uv: [8, 0, 16, 8], texture: "t1" },
    } }],
    outliner: [{ uuid: "g1", origin: [2, 2, 2], rotation, children: ["e1"] }],
  });
  const decode = (b: Uint8Array) => decodePng(b);
  const plain = unshaded(bbModel(file(), { decode }).quads);
  assert.equal(at(plain, FRONT, 0.5, 0.5), pack(255, 0, 0));
  // +90 about y (right-handed) swings the west face round to the south
  const turned = unshaded(bbModel(file([0, 90, 0]), { decode }).quads);
  assert.equal(at(turned, FRONT, 0.5, 0.5), pack(0, 0, 255));
  assert.throws(() => bbModel({}, { decode }), /not a Blockbench model/);
});
