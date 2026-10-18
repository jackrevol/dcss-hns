import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url))
await build({entryPoints:[root+'/native/cli.ts'],outfile:root+'/native/dist/cli.mjs',bundle:true,
  platform:'node',target:'node22',format:'esm',define:{'import.meta.env':'{}'},
})
