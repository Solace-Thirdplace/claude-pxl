import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pack } from "../src/core/color.ts";
import { Img } from "../src/core/image.ts";
import { loadProject } from "../src/node/load.ts";
import { writeOutputs } from "../src/node/output.ts";
import { buildModel3d, packResolver, readTexture } from "../src/node/model3d.ts";
import { decodePng, encodePng } from "../src/node/png.ts";
import { art, failure, PAL } from "./helpers.ts";

test("uvbox: stamps each face at its box-UV spot and checks sizes", () => {
  const src = PAL + `
sprite("_f", { w: 2, h: 3 }, rect(0, 0, 2, 3, "r"))
sprite("_s", { w: 1, h: 3 }, rect(0, 0, 1, 3, "g"))
sprite("_t", { w: 2, h: 1 }, rect(0, 0, 2, 1, "w"))
sprite("b", { w: 6, h: 4 }, uvbox(0, 0, 2, 3, 1, { top: "_t", bottom: "_t", right: "_s", front: "_f", left: { name: "_s" }, back: "_f" }))`;
  assert.equal(art(src, "b"), [".wwww.", "grrgrr", "grrgrr", "grrgrr"].join("\n"));
  const bad = failure(PAL + `
sprite("_f", { w: 3, h: 3 }, rect(0, 0, 3, 3, "r"))
sprite("b", { w: 8, h: 8 }, uvbox(0, 0, 2, 3, 1, { front: "_f" }))`, "b");
  assert.match(bad.message, /uvbox front at 1,1 is 2x3, but '_f' is 3x3/);
  assert.match(failure(PAL + `sprite("b", { w: 8, h: 8 }, uvbox(0, 0, 2, 3, 1, { frnt: "_f" }))`).message, /unknown option 'frnt'.*front/);
});

test("model3d: declaration checks, --only, and out/_3d sheets from pxl assets and PNG files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pxl3d-"));
  const tex = new Img(16, 16).fill(pack(200, 40, 40));
  writeFileSync(join(dir, "sword.png"), encodePng(tex));
  writeFileSync(join(dir, "art.px.js"), PAL + `
sprite("layer", { w: 64, h: 32 }, rect(0, 0, 64, 32, "r"))
sprite("gem", { w: 4, h: 4 }, rect(1, 1, 2, 2, "g"))
model3d("worn", { armor: { layer1: "layer", layer2: "layer" } })
model3d("gem_item", { item: "gem" })
model3d("file_item", { item: "sword.png", turn: 180, scale: 3 })`);
  const p = loadProject(join(dir, "art.px.js"));
  assert.equal(p.models3d.length, 3);
  const r = writeOutputs(p, join(dir, "out"), { only: ["worn", "file_item"] });
  assert.deepEqual(r.errors, []);
  assert.ok(existsSync(join(dir, "out", "_3d", "worn.png")));
  assert.ok(existsSync(join(dir, "out", "_3d", "file_item.png")));
  assert.ok(!existsSync(join(dir, "out", "_3d", "gem_item.png")));
  const sheet = decodePng(readFileSync(join(dir, "out", "_3d", "worn.png")));
  assert.ok(sheet.w > sheet.h * 4);
  const fileItem = buildModel3d(p, p.models3d[2]);
  assert.equal(fileItem.turn, 180);
  assert.ok(fileItem.files[0].endsWith("sword.png"));

  assert.match(failure(PAL + `model3d("m", { item: "a", java: "b.json" })`).message, /exactly one of armor, java, bbmodel, item/);
  assert.match(failure(PAL + `model3d("m", { armor: { layer3: "x" } })`).message, /unknown option 'layer3'/);
  assert.match(failure(PAL + `sprite("m", "r")\nmodel3d("m", { item: "m" })`).message, /'m' is already defined/);
  const missing = loadProject(join(dir, "art.px.js"));
  missing.models3d[0].opts.armor!.layer1 = "nope";
  assert.throws(() => buildModel3d(missing, missing.models3d[0]), /unknown texture 'nope'/);
});


test("pack resolver: resource-pack and ItemsAdder layouts, parents, and .mcmeta first frames", () => {
  const root = mkdtempSync(join(tmpdir(), "pxlpack-"));
  const put = (rel: string, data: string | Buffer) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), data);
  };
  const strip = new Img(16, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) strip.set(x, y, y < 16 ? pack(255, 0, 0) : pack(0, 0, 255));
  put("assets/mypack/textures/item/glow.png", encodePng(strip));
  put("assets/mypack/textures/item/glow.png.mcmeta", JSON.stringify({ animation: { frametime: 2 } }));
  put("iapack/models/item/base.json", JSON.stringify({ elements: [] }));
  const files: string[] = [];
  const r = packResolver([root], files);
  const t = r.texture("mypack:item/glow")!;
  assert.equal(t.h, 16);
  assert.equal(t.get(0, 15), pack(255, 0, 0));
  assert.deepEqual(r.model("iapack:item/base"), { elements: [] });
  assert.equal(r.model("iapack:item/none"), undefined);
  assert.equal(files.length, 2);
  assert.equal(readTexture(join(root, "assets/mypack/textures/item/glow.png")).h, 16);
});
