// Flat item extrusion: how Minecraft turns an item/generated sprite into a 1-pixel-thick model.
// The sprite fills x/y 0..16 on the plane z 7.5..8.5, readable from the south (+z).
import type { Img } from "../image.ts";
import { type Quad, type Vec3, faceCorners, rectUV } from "../raster3d.ts";
import type { Model } from "./common.ts";

/** Extrude one or more sprite layers (layer0 first; later layers draw on top). */
export function extrudeItem(layers: Img[]): Model {
  const quads: Quad[] = [];
  layers.forEach((tex, n) => {
    const sx = 16 / tex.w, sy = 16 / tex.h;
    // Later layers sit a hair proud of earlier ones so they win the depth test on both sides.
    const z0 = 7.5 - n * 0.01, z1 = 8.5 + n * 0.01;
    quads.push(
      { p: faceCorners([0, 0, z0], [16, 16, z1], "south"), uv: rectUV([0, 0, tex.w, tex.h]), tex },
      { p: faceCorners([0, 0, z0], [16, 16, z1], "north"), uv: rectUV([tex.w, 0, 0, tex.h]), tex },
    );
    const solid = (x: number, y: number) => (tex.get(x, y) & 255) !== 0;
    for (let y = 0; y < tex.h; y++)
      for (let x = 0; x < tex.w; x++) {
        if (!solid(x, y)) continue;
        const a: Vec3 = [x * sx, 16 - (y + 1) * sy, z0], b: Vec3 = [(x + 1) * sx, 16 - y * sy, z1];
        const uv = rectUV([x, y, x + 1, y + 1]);
        if (!solid(x - 1, y)) quads.push({ p: faceCorners(a, b, "west"), uv, tex });
        if (!solid(x + 1, y)) quads.push({ p: faceCorners(a, b, "east"), uv, tex });
        if (!solid(x, y - 1)) quads.push({ p: faceCorners(a, b, "up"), uv, tex });
        if (!solid(x, y + 1)) quads.push({ p: faceCorners(a, b, "down"), uv, tex });
      }
  });
  return { quads, warnings: [] };
}
