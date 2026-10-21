# Office Scene Assets

This directory contains the static Pixi textures for the office scene:

| File | Runtime role |
| --- | --- |
| `office.png` | background texture |
| `desk.png` | desk/workstation texture |
| `chair.png` | chair texture |

`src/scene/assets/loadOfficeAssets.ts` loads these files from the public URLs
`/assets/office/office.png`, `/assets/office/desk.png`, and
`/assets/office/chair.png`. Background failure falls back to a solid scene
background; desk/chair failure falls back to vector-drawn furniture. Keep
filenames and casing stable, because Vite public paths are case-sensitive on
Linux and macOS filesystems can hide casing mistakes during local development.

These are presentation resources only. They are not scanned by
`/office/files`, are never written by the action gateway, and should not be
used as OpenPaw session or task fixtures. After replacing an image, run
`npm run build` and a Playwright smoke test to verify the asset resolves in the
production-like server.
