# pxl for Minecraft textures

Read this when the art is a Minecraft texture: item icons, armour, model textures (Java block or
item models, Blockbench), skins. It covers the box-UV layout, the `uvbox` op, and `model3d`
previews. The rule that matters most: **after every build, read `out/_3d/<name>.png`**. A texture
can look right on the flat sheet and still be wrong on the model (an upside-down face, a seam,
a hole that shows skin).

## Item icons

16x16 (or 32x32) PNGs with transparency. A common recipe: draw 14x14 with `outline: "k"` (outline
grows the canvas to 16x16), `mx: true` for symmetric items, and a `base` + `swap` sprite per tier:

```js
sprite("iron_sword", { w: 14, h: 14, outline: "k" }, layer("art", { y: 1 }, `...`))
sprite("gold_sword", { base: "iron_sword", swap: { s: "y", S: "Y" } })
model3d("iron_sword_held", { item: "iron_sword" })      // the extruded 3D item
```

## The box-UV layout (`uvbox`)

Skins, armour layers, entity textures and Blockbench box-UV cubes all unfold a w x h x d box the
same way at texel offset (u, v):

```
        u      u+d     u+d+w    u+2d+w   u+2d+2w
  v     .      top     bottom   .
  v+d   right  front   left     back
```

`right` and `left` are the wearer's sides (the right side is on your left when you face them).
Each side face reads correctly when seen from outside, and the strip wraps around the body:
right, front, left, back. The **bottom** face is stored with the box's back edge on its top row.

```js
uvbox(u, v, w, h, d, { top, bottom, right, front, left, back })
```

stamps one asset per face at its spot and fails with a clear message if an asset isn't that
face's size (top/bottom w x d, front/back w x h, right/left d x h). A face is an asset name or
`{ name, ...placement }`, e.g. `left: { name: "_side", flip: "x" }` to mirror a shared side panel.

### Armour (64x32)

`layer_1` holds the helmet, chestplate and boots; `layer_2` holds the leggings.

| Box | uvbox | Used by |
|---|---|---|
| head | `uvbox(0, 0, 8, 8, 8, ...)` | helmet (layer_1) |
| hat (helmet overlay, drawn 0.5 larger) | `uvbox(32, 0, 8, 8, 8, ...)` | helmet (layer_1) |
| body | `uvbox(16, 16, 8, 12, 4, ...)` | chestplate (layer_1), leggings waist (layer_2) |
| arm | `uvbox(40, 16, 4, 12, 4, ...)` | chestplate (layer_1) |
| leg | `uvbox(0, 16, 4, 12, 4, ...)` | boots (layer_1, lower rows), leggings (layer_2) |

Draw the right arm and right leg only: the game mirrors them for the left limbs. In game, armour
is drawn inflated around the body (layer_1 by 1 pixel, layer_2 by 0.5) and both sides of every
face render, so transparent gaps show the inside of the far wall.

```js
sprite("steel_layer_1", { w: 64, h: 32 },
  uvbox(0, 0, 8, 8, 8, { top: "_helm_top", right: "_helm_side", front: "_helm_front", left: { name: "_helm_side", flip: "x" }, back: "_helm_back" }),
  uvbox(16, 16, 8, 12, 4, { top: "_chest_top", right: "_chest_side", front: "_chest_front", left: "_chest_side", back: "_chest_back" }),
  uvbox(40, 16, 4, 12, 4, { top: "_arm_top", right: "_arm", front: "_arm", left: "_arm", back: "_arm" }),
  uvbox(0, 16, 4, 12, 4, { right: "_boot", front: "_boot_front", left: "_boot", back: "_boot" }))
model3d("steel_worn", { armor: { layer1: "steel_layer_1", layer2: "steel_layer_2" } })
```

A full working set with icons and a recoloured second tier: `examples/minecraft_armor.px.js`.

## `model3d`: see the texture on the model

```js
model3d(name, { armor | java | bbmodel | item, textures?, pack?, turn?, scale? })
```

| Source | Meaning |
|---|---|
| `armor: { layer1, layer2, pieces?, skin? }` | Worn on a player. `pieces` limits to `"helmet"`, `"chestplate"`, `"leggings"`, `"boots"`. The body is a flat-colour mannequin unless `skin` names a 64x64 or 64x32 skin; `skin: false` hides it. |
| `java: "models/sword.json"` | Java block/item model: elements, face UVs and rotation, element rotation, `parent` chain, texture variables. Parents named `item/generated` or `item/handheld` become an extruded item. |
| `bbmodel: "sword.bbmodel"` | Blockbench project: cubes, group (bone) rotations, embedded textures. Mesh elements are skipped with a warning. |
| `item: "icon"` or `["layer0", "layer1"]` | Flat item extrusion, the way the game renders generated items. |

Texture references are **pxl asset names** (so editing a sprite re-renders the model) or `.png`
paths relative to the art file. `textures` overrides a Java texture variable (`"0"`, `"layer0"`) or
a Blockbench texture (by name or index). `pack` adds resource-pack or ItemsAdder `contents/`
folders for parents and `namespace:path` textures; a model file inside `assets/` or `contents/`
finds its pack on its own. `turn: 180` is for models built facing north (ModelEngine and most
Bedrock-style Blockbench models), so their face is in the "front" view.

`pxl build` writes `out/_3d/<name>.png`: front, right, back, left, top, and two 3/4 views at the
same scale, with labels. `pxl serve` lists models under "3d models": drag to orbit, scroll to
zoom, toggle parts (body, helmet, ...), and the view follows texture edits.

Anything with a missing texture renders magenta/black, like the game, and is listed as a warning
in the build output.

### Textures not made in pxl

```
pxl view3d model.json [--pack DIR] [--texture 0=other.png] [--turn 180] [--views front,3/4 front]
pxl view3d model.bbmodel
pxl view3d icon.png                                   # extruded item
pxl view3d layer_1.png layer_2.png --armor [--skin skin.png | --no-skin]
```

Output goes to the system temp folder (`<tmp>/pxl-view3d/_3d/<name>.png`, printed) unless
`--out DIR` is given, so it never writes beside a live resource pack.

## Animated textures

Minecraft wants frames stacked **vertically** in one PNG plus a `.mcmeta` file
(`{"animation": {"frametime": 2}}`). pxl's anim strips are horizontal, so convert the strip, or
draw the frames as one tall sprite with `layer({ y: 16 * n })` per frame. model3d and view3d show
frame 0.
