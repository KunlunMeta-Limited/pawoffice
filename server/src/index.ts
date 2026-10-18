import { createPawOfficeServer, defaultStaticRoot } from './app.ts'

const port = Number(process.env.PORT ?? 8765)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const app = await createPawOfficeServer({
  apiKey: process.env.PAWOFFICE_API_KEY,
  publicOrigin: process.env.PAWOFFICE_PUBLIC_ORIGIN,
  staticRoot: process.env.PAWOFFICE_SERVE_STATIC === 'false' ? undefined : process.env.PAWOFFICE_STATIC_ROOT ?? defaultStaticRoot,
  logger: true,
})
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)) })
