// Preflight: assert the built client bundle carries the exact
// `window.__ModuleLoader__.load({ id: ... })` banner the DSH web shell
// expects. A mis-wrapped bundle loads without error but never registers,
// which is silent in production — this gate makes it loud in CI.

import { readFileSync } from 'node:fs'

const id = 'dsh-skill-manager'
const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}`

const bundle = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
if (!bundle.startsWith(banner)) {
  console.error(`preflight: client/client.js must start with ${JSON.stringify(banner)}`)
  process.exit(1)
}

console.log('preflight: client bundle banner ok')
