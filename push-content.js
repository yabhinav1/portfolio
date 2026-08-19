// One-shot: copy everything from the local portfolio.db into the Turso database.
// Usage:  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node push-content.js
import { createClient } from '@libsql/client'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env
if (!url) { console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN).'); process.exit(1) }

const local = createClient({ url: `file:${path.join(root, 'portfolio.db')}` })
const remote = createClient({ url, authToken })

const TABLES = ['settings', 'projects', 'experience', 'skills']   // messages stay local on purpose

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
