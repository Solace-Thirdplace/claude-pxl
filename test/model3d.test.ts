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

test("cli view3d: renders an item PNG and armour layers to --out, rejects unknown views", async () => {
  const { main } = await import("../src/node/cli.ts");
  const dir = mkdtempSync(join(tmpdir(), "pxlv3d-"));
  writeFileSync(join(dir, "gem.png"), encodePng(new Img(16, 16).fill(pack(10, 200, 90))));
  writeFileSync(join(dir, "layer_1.png"), encodePng(new Img(64, 32).fill(pack(90, 90, 200))));
  const log = console.log, err = console.error, said: string[] = [];
  console.log = (s: string) => said.push(s);
  console.error = (s: string) => said.push(s);
  try {
    assert.equal(await main(["view3d", join(dir, "gem.png"), "--out", join(dir, "o"), "--views", "front,top"]), 0);
    assert.equal(await main(["view3d", join(dir, "layer_1.png"), "--armor", "--no-skin", "--out", join(dir, "o")]), 0);
    assert.equal(await main(["view3d", join(dir, "gem.png"), "--views", "sideways"]), 1);
  } finally { console.log = log; console.error = err; }
  assert.ok(existsSync(join(dir, "o", "_3d", "gem.png")));
  assert.ok(existsSync(join(dir, "o", "_3d", "layer_1.png")));
  assert.match(said.join("\n"), /unknown view 'sideways'/);
});

test("server: model3d state and payload, browser core modules, rebuild when a texture file changes", async () => {
  const { serve } = await import("../src/node/server.ts");
  const dir = mkdtempSync(join(tmpdir(), "pxl3dsrv-"));
  writeFileSync(join(dir, "skin.png"), encodePng(new Img(64, 32).fill(pack(90, 90, 200))));
  const file = join(dir, "a.px.js");
  writeFileSync(file, PAL + `
sprite("plate", { w: 64, h: 32 }, rect(0, 0, 64, 32, "r"))
model3d("worn", { armor: { layer1: "plate", skin: "skin.png" }, turn: 90 })
model3d("broken", { item: "missing.png" })`);
  const s = await serve(file, { port: 0, out: false, log: () => {} });
  try {
    const st = await (await fetch(s.url + "api/state")).json();
    const worn = st.models3d.find((m: { name: string }) => m.name === "worn");
    assert.deepEqual(worn.groups, ["body", "helmet", "chestplate", "boots"]);
    assert.match(st.models3d.find((m: { name: string }) => m.name === "broken").error.message, /texture file not found/);
    const m = await (await fetch(s.url + "api/model3d?name=worn")).json();
    assert.equal(m.turn, 90);
    assert.equal(m.textures.length, 2);
    assert.equal(m.quads.length, worn.faces);
    assert.equal((await fetch(s.url + "api/model3d?name=nope")).status, 404);
    assert.equal((await fetch(s.url + "core/project.ts")).status, 404);

    // The browser imports these four modules; the served code must be plain JS that runs.
    const mods = join(dir, "core");
    mkdirSync(mods);
    for (const f of ["raster3d.ts", "color.ts", "font.ts", "image.ts"]) {
      const r = await fetch(s.url + "core/" + f);
      assert.equal(r.status, 200);
      writeFileSync(join(mods, f.replace(/\.ts$/, ".mjs")), (await r.text()).replace(/from "\.\/(\w+)\.ts"/g, 'from "./$1.mjs"'));
    }
    const R = await import(join(mods, "raster3d.mjs"));
    const img = R.render([{ p: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], tex: new (await import(join(mods, "image.mjs"))).Img(1, 1).fill(pack(255, 0, 0)), shade: false }], { yaw: 0, pitch: 0 }, { scale: 2, w: 2, h: 2, center: [0.5, 0.5, 0] });
    assert.equal(img.data[0], pack(255, 0, 0));
    const app = await (await fetch(s.url + "app.js")).text();
    assert.ok(app.includes("/core/raster3d.ts") && !app.includes("interface Model3dInfo"));

    // Editing the skin PNG (not an art file) rebuilds and changes the model's hash.
    writeFileSync(join(dir, "skin.png"), encodePng(new Img(64, 32).fill(pack(10, 200, 10))));
    const t0 = Date.now();
    let after = worn.hash;
    while (Date.now() - t0 < 5000 && after === worn.hash) {
      await new Promise((r) => setTimeout(r, 100));
      after = (await (await fetch(s.url + "api/state")).json()).models3d[0].hash;
    }
    assert.notEqual(after, worn.hash, "texture edit did not rebuild the model");
  } finally {
    s.close();
  }
});

test("examples/minecraft_armor builds every sprite, sheet and model3d without errors", () => {
  const p = loadProject(join(import.meta.dirname, "..", "examples", "minecraft_armor.px.js"));
  const r = writeOutputs(p, mkdtempSync(join(tmpdir(), "pxlex-")), { preview: false });
  assert.deepEqual(r.errors.map((e) => e.message), []);
  assert.equal(r.lines.filter((l) => l.startsWith("model3d ")).length, 4);
  assert.ok(!r.lines.some((l) => l.includes("warning")));
});
