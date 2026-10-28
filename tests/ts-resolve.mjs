// Test-only loader: lets `node --test` import app TypeScript the way Next resolves it
// (`@/` alias, extensionless relative imports, and a no-op `server-only`).
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true }
    const local = specifier.startsWith('@/') ? new URL(specifier.slice(2), root)
      : (specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:') ? new URL(specifier, context.parentURL) : null
    if (local && !/\.[cm]?[jt]sx?$/.test(local.pathname)) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        const candidate = fileURLToPath(local) + ext
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(local ? local.href : specifier, context)
  },
})
