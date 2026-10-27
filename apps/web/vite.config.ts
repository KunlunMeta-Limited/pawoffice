import path from 'node:path'
import { readFile } from 'node:fs/promises'
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
  }, {
    name: 'result-preview-mock',
    // Dev-only mock endpoint for ?result-preview=1. Edit the JSON and reload the page.
    configureServer(server) {
      const file = path.resolve(root, 'src/dev/mock/result-preview.json')
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0].split('/').filter(Boolean).pop() !== 'result-preview.json') { next(); return }
        readFile(file, 'utf8').then(body => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        }).catch(next)
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
