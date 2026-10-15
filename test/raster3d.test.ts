import { test } from "node:test";
import assert from "node:assert/strict";
import { TRANSPARENT, pack } from "../src/core/color.ts";
import { Img } from "../src/core/image.ts";
import { type Face, FACES, type Quad, type Vec3, faceCorners, faceShade, rectUV, render, renderViews, rotateUV, rotatePoint } from "../src/core/raster3d.ts";

/** 4x4 texture where every texel is distinct: red = 40 * x, green = 40 * y. */
function labelled(n = 4): Img {
  const t = new Img(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) t.set(x, y, pack(40 + 40 * x, 40 + 40 * y, 200));
  return t;
}

/** Texel (x, y) of `labelled` recovered from a rendered color, or "." for transparent. */
function texel(c: number): string {
  if (c === TRANSPARENT) return ".";
  return `${Math.round(((c >>> 24) & 255) / 40) - 1}${Math.round(((c >>> 16) & 255) / 40) - 1}`;
}

function grid(img: Img): string[] {
  const rows: string[] = [];
  for (let y = 0; y < img.h; y++) rows.push([...img.data.subarray(y * img.w, (y + 1) * img.w)].map(texel).join(" "));
  return rows;
}

const UPRIGHT = ["00 10 20 30", "01 11 21 31", "02 12 22 32", "03 13 23 33"];

const CAMERA: Record<Face, { yaw: number; pitch: number }> = {
  south: { yaw: 0, pitch: 0 }, north: { yaw: 180, pitch: 0 }, east: { yaw: 90, pitch: 0 },
  west: { yaw: 270, pitch: 0 }, up: { yaw: 0, pitch: 90 }, down: { yaw: 0, pitch: -90 },
};

function faceQuad(face: Face, tex = labelled()): Quad {
  return { p: faceCorners([0, 0, 0], [4, 4, 4], face), uv: rectUV([0, 0, 4, 4]), tex, shade: false };
}

test("raster3d: every box face reads upright and unmirrored from its own side", () => {
  for (const face of FACES) {
    const img = render([faceQuad(face)], CAMERA[face], { scale: 1, w: 4, h: 4, center: [2, 2, 2] });
    assert.deepEqual(grid(img), UPRIGHT, face);
  }
});

test("raster3d: back faces are culled unless cull is false, which shows the mirror image", () => {
  const back = { yaw: 180, pitch: 0 };
  const culled = render([faceQuad("south")], back, { scale: 1, w: 4, h: 4, center: [2, 2, 2] });
  assert.ok(culled.data.every((c) => c === TRANSPARENT));
  const both = render([{ ...faceQuad("south"), cull: false }], back, { scale: 1, w: 4, h: 4, center: [2, 2, 2] });
  assert.deepEqual(grid(both), ["30 20 10 00", "31 21 11 01", "32 22 12 02", "33 23 13 03"]);
});

test("raster3d: nearer faces win and scale enlarges texels", () => {
  const red = new Img(1, 1).fill(pack(255, 0, 0)), blue = new Img(1, 1).fill(pack(0, 0, 255));
  const near: Quad = { p: faceCorners([0, 0, 0], [2, 2, 3], "south"), uv: rectUV([0, 0, 1, 1]), tex: red, shade: false };
  const far: Quad = { p: faceCorners([0, 0, 0], [2, 2, 1], "south"), uv: rectUV([0, 0, 1, 1]), tex: blue, shade: false };
  for (const order of [[near, far], [far, near]]) {
    const img = render(order, { yaw: 0, pitch: 0 }, { scale: 3, w: 6, h: 6, center: [1, 1, 0] });
    assert.ok(img.data.every((c) => c === pack(255, 0, 0)));
  }
});

test("raster3d: translucent texels blend over what is behind them", () => {
  const glass = new Img(1, 1).fill(pack(255, 255, 255, 128)), wall = new Img(1, 1).fill(pack(0, 0, 0));
  const img = render([
    { p: faceCorners([0, 0, 0], [1, 1, 2], "south"), uv: rectUV([0, 0, 1, 1]), tex: glass, shade: false },
    { p: faceCorners([0, 0, 0], [1, 1, 1], "south"), uv: rectUV([0, 0, 1, 1]), tex: wall, shade: false },
  ], { yaw: 0, pitch: 0 }, { scale: 1, w: 1, h: 1, center: [0.5, 0.5, 0] });
  assert.equal(img.data[0], pack(128, 128, 128));
});

test("raster3d: face shading and UV / point rotation helpers", () => {
  assert.equal(faceShade([0, 1, 0]), 1);
  assert.equal(faceShade([0, -1, 0]), 0.5);
  assert.equal(faceShade([0, 0, 1]), 0.8);
  assert.equal(faceShade([1, 0, 0]), 0.6);
  // rotation 90: the texture turns clockwise, so the top-right corner now shows the old top-left texel
  assert.deepEqual(rotateUV(rectUV([0, 0, 4, 4]), 90), [[0, 4], [0, 0], [4, 0], [4, 4]]);
  const r = rotatePoint([1, 0, 0], [0, 0, 0], "y", 90).map((v) => Math.round(v * 1e6) / 1e6 + 0) as Vec3;
  assert.deepEqual(r, [0, 0, -1]);
});

test("raster3d: a rotated texture face renders turned clockwise", () => {
  const q = { ...faceQuad("south"), uv: rotateUV(rectUV([0, 0, 4, 4]), 90) };
  const img = render([q], { yaw: 0, pitch: 0 }, { scale: 1, w: 4, h: 4, center: [2, 2, 2] });
  assert.deepEqual(grid(img), ["03 02 01 00", "13 12 11 10", "23 22 21 20", "33 32 31 30"]);
});

test("raster3d: view sheet lays out one labelled frame per view", () => {
  const cube = FACES.map((f) => faceQuad(f));
  const s = renderViews(cube, undefined, { scale: 2 });
  assert.equal(s.views.length, 7);
  assert.equal(new Set(s.views.map((v) => v.w)).size, 1);
  assert.ok(s.img.w > s.views[0].w * 7);
});
