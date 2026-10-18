import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

for (const base of ['/', '/preview/']) {
  test(`office homepage and scene examples work under ${base}`, async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'pawoffice-navigation-'))
    const server = await createServer({
      configFile: fileURLToPath(new URL('../apps/web/vite.config.ts', import.meta.url)),
      base,
      cacheDir,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, ws: false, watch: null, preTransformRequests: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    const http = createHttpServer(server.middlewares)
    try {
      await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
      const origin = `http://127.0.0.1:${http.address().port}`
      const home = await fetch(`${origin}${base}`)
      assert.equal(home.status, 200)
      const homeHtml = await home.text()
      assert.match(homeHtml, /src\/main\.tsx/)
      assert.match(homeHtml, /PawOffice · 完整办公室/)
      assert.doesNotMatch(homeHtml, /src\/website\/|canonical|pawoffice\.online/)
      assert.ok(homeHtml.includes(`src="${base}pawoffice-config.js"`))
      const config = await fetch(`${origin}${base}pawoffice-config.js`)
      assert.equal(config.status, 200)
      assert.match(await config.text(), /__PAWOFFICE_CONFIG__/)

      for (const entry of ['office/', 'office/index.html']) {
        const office = await fetch(`${origin}${base}${entry}`)
        assert.equal(office.status, 200)
        const html = await office.text()
        assert.match(html, /id="root"/)
        assert.match(html, /src\/main\.tsx/)
        assert.match(html, /PawOffice · 完整办公室/)
        assert.ok(html.includes(`src="${base}pawoffice-config.js"`))
      }

      for (const entry of ['minimal/', 'minimal/index.html']) {
        const response = await fetch(`${origin}${base}${entry}`)
        assert.equal(response.status, 200)
        const html = await response.text()
        assert.ok(html.includes(`href="${base}"`), 'return link stays in the deployment base')
        assert.match(html, /返回办公室/)
        assert.match(html, /id="office"/)
        assert.match(html, /id="visit-form"/)
        assert.ok(html.includes(`href="${base}brand/logo.png"`))
      }

      for (const entry of ['farm/', 'farm/index.html']) {
        const response = await fetch(`${origin}${base}${entry}`)
        assert.equal(response.status, 200)
        const html = await response.text()
        assert.match(html, /PawOffice · 农场/)
        assert.match(html, /src\/farm\.tsx/)
        assert.ok(html.includes(`href="${base}brand/logo.png"`))
      }

      const entry = await readFile(new URL('../apps/web/src/minimal.ts', import.meta.url), 'utf8')
      assert.match(entry, /minimal-vanilla\/src\/main\.ts/)
      const source = await readFile(new URL('../apps/web/src/ui/OfficeShell.tsx', import.meta.url), 'utf8')
      assert.match(source, /最小装配/)
      assert.ok(source.includes('href={`${import.meta.env.BASE_URL}minimal/`}'))
      assert.match(source, /alt="PawOffice"/)
      assert.doesNotMatch(source, /官网|website/)
      await assert.rejects(access(new URL('../apps/web/office/index.html', import.meta.url)), { code: 'ENOENT' })
      await assert.rejects(access(new URL('../apps/web/src/website', import.meta.url)), { code: 'ENOENT' })
    } finally {
      http.closeAllConnections()
      await new Promise(resolve => http.close(resolve))
      await server.close()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
}
