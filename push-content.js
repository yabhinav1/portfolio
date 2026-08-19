// Copy local portfolio.db into Turso.
// TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node push-content.js
import { createClient } from '@libsql/client'
import path from 'node:path'
import { SCHEMA } from './lib.js'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env
if (!url) { console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN).'); process.exit(1) }

const local = createClient({ url: `file:${path.join(root, 'portfolio.db')}` })
const remote = createClient({ url, authToken })

await remote.executeMultiple(SCHEMA)

const TABLES = ['settings', 'projects', 'experience', 'skills']   // messages aren't copied

for (const t of TABLES) {
  const { rows } = await local.execute(`select * from ${t}`)
  await remote.execute(`delete from ${t}`)
  for (const row of rows) {
    const cols = Object.keys(row)
    await remote.execute({
      sql: `insert into ${t} (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`,
      args: cols.map(c => row[c]),
    })
  }
  console.log(`${t}: ${rows.length} rows`)
}
console.log('\nDone. Redeploy or just reload the site.')
