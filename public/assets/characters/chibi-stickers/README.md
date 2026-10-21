# Chibi Stickers Pack

`chibi-stickers` is the active Spine character resource pack for the office
scene. `chibi-stickers.json` contains skeleton, skins, and animation data;
`chibi-stickers.atlas` maps atlas regions; the numbered PNG files are atlas
pages; and `chibi-stickers.json` is loaded directly by the Pixi Spine runtime.

The loader registers these stable public URLs:

```text
/assets/characters/chibi-stickers/chibi-stickers.json
/assets/characters/chibi-stickers/chibi-stickers.atlas
```

The atlas page references must remain relative to the atlas file. The scene
maps office agents to the available skins in
`src/scene/characters/chibiStickerSkins.ts`; nine skins are reused by the
roster when more agents exist than skins. Keep the exported Spine version
compatible with `@esotericsoftware/spine-pixi-v8` and smoke-test both a normal
load and the programmatic fallback after replacing files.
