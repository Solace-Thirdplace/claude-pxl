// Minecraft armour set: 4 inventory icons, the two 64x32 worn-armour layers (uvbox), a second
// tier made by one palette swap, and model3d previews of everything (out/_3d/*.png).
// See minecraft.md for the layout.
pal({
  k: "#120d1c",                                                  // outline / darkest
  d: "#2a1f3d", p: "#45335f", P: "#6a5490", h: "#9a86c4",       // plate ramp
  e: "#b48cff",                                                  // trim
  g: "#e05cff", G: "#ffc2ff",                                    // gem
})
ramps("kdpPh")

// ---- worn-armour faces (parts, placed onto the UV sheet below) ----
// Head is 8x8x8. Front leaves the lower face open.
sprite("_helm_front", { w: 8, h: 8, mx: true }, `
  kpPP
  pPhh
  pPeg
  kkkk
  pk..
  pk..
  dk..
  kd..`)
sprite("_helm_side", { w: 8, h: 8 }, `
  kpPPPPpk
  pPhhhhPp
  pPPPPPPp
  pPPeePPp
  dPPeePPd
  dpPPPPpd
  dppppppd
  kddddddk`)
sprite("_helm_back", { w: 8, h: 8, mx: true }, `
  kpPP
  pPhe
  pPPe
  pPPe
  dpPe
  dpPe
  dppe
  kddk`)
sprite("_helm_top", { w: 8, h: 8, mx: true }, `
  kppe
  pPPe
  pPhe
  pPhe
  pPhe
  pPhe
  pPPe
  kppe`)

// Body is 8x12x4.
sprite("_chest_front", { w: 8, h: 12, mx: true }, `
  kpPk
  pPhe
  pPPe
  pPeg
  pPPe
  dpPe
  kdpe
  dkpP
  dpPP
  kdpe
  dpPe
  kkkk`)
sprite("_chest_back", { w: 8, h: 12, mx: true }, `
  kpPP
  pPhP
  pPPe
  pPPe
  dpPe
  dpPe
  kdpe
  dkpe
  dppe
  kdpe
  dppe
  kkkk`)
sprite("_chest_side", { w: 4, h: 12 }, `
  pPPp
  pPhp
  pPPp
  dpPd
  dpPd
  dppd
  kdpk
  dkpd
  dppd
  kdpk
  dppd
  kkkk`)
sprite("_chest_top", { w: 8, h: 4, mx: true }, `
  kppp
  pPPh
  pPPh
  kppp`)

// Arm is 4x12x4: pauldron on top, bracer at the wrist, bare in between.
sprite("_arm_side", { w: 4, h: 12 }, `
  kppk
  pPhp
  pPhp
  eeee
  kddk
  ....
  ....
  ....
  kddk
  pPhp
  eeee
  kddk`)
sprite("_arm_top", { w: 4, h: 4 }, `
  kppk
  pPhp
  pPhp
  kppk`)

// Leg is 4x12x4. Boots are the lower five rows; leggings the upper nine.
sprite("_boot_side", { w: 4, h: 12 }, `
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  eeee
  pPhp
  pPhp
  dpPd
  kkkk`)
sprite("_boot_front", { w: 4, h: 12 }, `
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  eeee
  pPhp
  pgGp
  dpPd
  kkkk`)
sprite("_legs_side", { w: 4, h: 12 }, `
  pPhp
  pPhp
  pPhp
  dpPd
  eeee
  dpPd
  pPhp
  dpPd
  kddk`)
sprite("_legs_front", { w: 4, h: 12 }, `
  pPhp
  pPhp
  pPhp
  dpPd
  egGe
  dpPd
  pPhp
  dpPd
  kddk`)
sprite("_belt_front", { w: 8, h: 12, mx: true }, `
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  kkkk
  eeeg
  dddd`)
sprite("_belt_side", { w: 4, h: 12 }, `
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  ....
  kkkk
  eeee
  dddd`)

// ---- UV sheets (vanilla 64x32 humanoid layout) ----
const helm = { top: "_helm_top", right: "_helm_side", front: "_helm_front", left: { name: "_helm_side", flip: "x" }, back: "_helm_back" }
sprite("voidsteel_layer_1", { w: 64, h: 32 },
  uvbox(0, 0, 8, 8, 8, helm),
  uvbox(16, 16, 8, 12, 4, { top: "_chest_top", right: "_chest_side", front: "_chest_front", left: { name: "_chest_side", flip: "x" }, back: "_chest_back" }),
  uvbox(40, 16, 4, 12, 4, { top: "_arm_top", right: "_arm_side", front: "_arm_side", left: "_arm_side", back: "_arm_side" }),
  uvbox(0, 16, 4, 12, 4, { right: "_boot_side", front: "_boot_front", left: "_boot_side", back: "_boot_side" }),
  rect(8, 16, 4, 4, "k"))                                         // boot soles

sprite("voidsteel_layer_2", { w: 64, h: 32 },
  uvbox(16, 16, 8, 12, 4, { right: "_belt_side", front: "_belt_front", left: "_belt_side", back: "_belt_front" }),
  uvbox(0, 16, 4, 12, 4, { right: "_legs_side", front: "_legs_front", left: "_legs_side", back: "_legs_side" }))

// ---- inventory icons (16x16: 14x14 art + auto outline) ----
const icon = (name, y, art) => sprite(name, { w: 14, h: 14, mx: true, outline: "k" }, layer("art", { y }, art))

icon("voidsteel_helmet", 1, `
  ....pPP
  ..pPPhh
  .pPPhhh
  .pPPPPP
  pPPPPeg
  pPPPPeg
  pPkkkkk
  pPk....
  pPk....
  dpk....
  ddk....
  kd.....`)
icon("voidsteel_chestplate", 1, `
  pPP....
  pPhP...
  pPhhP..
  dpPhhPe
  .dpPPPe
  ..pPPeg
  ..pPPeg
  ..dpPPe
  ..dpPPP
  ..ddpPP
  ..eeeee
  ..ddddd`)
icon("voidsteel_leggings", 1, `
  .eeeeee
  .pPPPPg
  .pPhPPP
  .pPhP..
  .pPhP..
  .pPPP..
  .dpPP..
  .egGe..
  .dpPP..
  .ddpP..
  .ddpp..`)
icon("voidsteel_boots", 4, `
  ..pPP..
  ..pPh..
  ..egG..
  ..pPh..
  .pPPh..
  pPPPPP.
  dddddd.`)

// ---- second tier: one swap map, applied to every asset ----
const gilded = { k: "#2a1a08", d: "#5a3a12", p: "#a8741c", P: "#e0b030", h: "#fff0a0", e: "#fff8d8", g: "#3cd0ff", G: "#c8f6ff" }
for (const part of ["layer_1", "layer_2", "helmet", "chestplate", "leggings", "boots"])
  sprite("gilded_" + part, { base: "voidsteel_" + part, swap: gilded })

sheet("icons", ["voidsteel_helmet", "voidsteel_chestplate", "voidsteel_leggings", "voidsteel_boots",
  "gilded_helmet", "gilded_chestplate", "gilded_leggings", "gilded_boots"], { cols: 4, pad: 2 })

// ---- 3D previews ----
model3d("voidsteel_worn", { armor: { layer1: "voidsteel_layer_1", layer2: "voidsteel_layer_2" } })
model3d("gilded_worn", { armor: { layer1: "gilded_layer_1", layer2: "gilded_layer_2" } })
model3d("voidsteel_leggings_only", { armor: { layer2: "voidsteel_layer_2", pieces: ["leggings"] } })
model3d("voidsteel_helmet_held", { item: "voidsteel_helmet" })
