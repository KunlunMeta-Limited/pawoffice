# Office Artwork

The original furniture and room PNGs are source assets. `scripts/build-office-assets.mjs` generates the corresponding lossless WebP files; those outputs are ignored by Git.

`effects/work-crafting-lite-v1.png` and `.webp` are generated runtime atlases. The current white-cloud authoring sheet and production notes are retained in `art/office/work-crafting-v1/`; superseded sheets are recoverable from Git history.

`preview.webp` is the existing office layout preview used by the team overview and office creation form. It is a source asset and is committed directly. It was moved from the retired website asset directory without changing its image content.

The `reference-v1/` and `workstation-trial-v1/` directories retain the source artwork and production notes used by the current office.
