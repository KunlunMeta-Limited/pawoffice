import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { releaseAssetsPlugin } from '../../scripts/assets/release.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const relayUrl = process.env.PAWOFFICE_INTERNAL_API_URL
let relativeBase = false
export default defineConfig({
  root,
  envDir: path.resolve(root, '../..'),
  publicDir: path.resolve(root, '../../public'),
  plugins: [react(), releaseAssetsPlugin(), {
    name: 'office-entry-alias',
    configResolved(config) { relativeBase = config.base === './' || config.base === '' },
    configureServer(server) {
      const base = server.config.base
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '', query = url.indexOf('?')
        const pathname = query < 0 ? url : url.slice(0, query)
        if ([`${base}office`, `${base}office/`, `${base}office/index.html`].includes(pathname)) {
          req.url = `${base}index.html${query < 0 ? '' : url.slice(query)}`
        }
        next()
      })
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const home = bundle['index.html']
        if (!home || home.type !== 'asset') this.error('Missing office homepage')
        const html = String(home.source)
        this.emitFile({ type: 'asset', fileName: 'office/index.html',
          source: relativeBase ? html.replace(/\b(src|href)="\.\//g, '$1="../') : html })
      },
    },
  }, {
    name: 'character-candidate-preview',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (/^\/\.character-preview\/[a-f0-9]{64}\/[a-zA-Z0-9_./-]+(?:\?.*)?$/.test(req.url ?? '') && !req.url!.includes('..')) {
          req.url = `/@fs${path.resolve(root, '../..')}${req.url}`
        }
        next()
      })
    },
  }],
  resolve: { dedupe: ['pixi.js', 'react', 'react-dom'] },
  server: {
    fs: { allow: [path.resolve(root, '../..')] },
    proxy: relayUrl ? {
      '/api/pawoffice': { target: relayUrl },
      '/pawoffice-config.js': { target: relayUrl },
    } : undefined,
  },
  build: {
    outDir: path.resolve(root, '../../dist'), emptyOutDir: true,
    rolldownOptions: {
      input: {
        home: path.resolve(root, 'index.html'),
        minimal: path.resolve(root, 'minimal/index.html'),
        classroom: path.resolve(root, 'classroom/index.html'),
        farm: path.resolve(root, 'farm/index.html'),
      },
    },
  },
})
