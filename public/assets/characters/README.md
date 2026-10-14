# Character Assets

This directory contains the browser-served character packs used by the Pixi
office scene. The current pack is `chibi-stickers`, a Spine 4.2 export with a
JSON skeleton, atlas, atlas page PNGs, and a small manifest JSON supplied by
the asset exporter.

## Runtime Boundary

`src/scene/assets/loadSpineAssets.ts` registers the pack with Pixi Assets and
loads it from `/assets/characters/chibi-stickers/`. The scene can fall back to
programmatic characters when the pack cannot be loaded; asset failure must not
prevent the dashboard or gateway from starting. These files are static public
resources and are not part of the OpenPaw filesystem scanners.

## Layout and Change Rules

Keep each pack self-contained in a named child directory. Update the loader's
pack table when adding a pack, preserve the relative URL casing, and verify a
production Vite build can resolve every JSON/atlas/PNG reference. Do not put
generated build output or `node_modules` in this directory. Review asset
licensing and attribution with the source artist before redistribution; this
README records technical ownership only.
