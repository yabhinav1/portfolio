import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { put } from '@vercel/blob'
import { slugify, fill, SCHEMA } from './lib.js'
import { homePage, projectPage, notFound } from './views/site.js'
import { adminList, adminForm, adminSettings, adminInbox, loginPage } from './views/admin.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin'
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
const SITE = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '')
const DATA = process.env.DATA_DIR || root
const TURSO = !!process.env.TURSO_DATABASE_URL
// OIDC-linked Blob stores set BLOB_STORE_ID instead of a token
const BLOB = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL)
if (!BLOB) fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true })
if (!process.env.ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD not set, using "admin". Set it before deploying.')

/* ---------- db ---------- */
if (process.env.VERCEL && !TURSO) {
  throw new Error('TURSO_DATABASE_URL is not set. Serverless has no writable disk, so the local SQLite file cannot be used. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the project environment variables.')
}

// file: locally, Turso in production
const client = createClient(TURSO
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: `file:${path.join(DATA, 'portfolio.db')}` })

const all = (sql, ...args) => client.execute({ sql, args }).then(r => r.rows)
const get = (sql, ...args) => all(sql, ...args).then(r => r[0])
const run = (sql, ...args) => client.execute({ sql, args })

const DEFAULTS = {
  name: 'Your Name', role: 'Full-stack developer', location: 'Bengaluru, India',
  tagline: 'I build web products end to end, from the first sketch to the deploy.',
  about: 'Replace this in /admin → Settings.\n\nWrite two short paragraphs about how you work and what you care about. Specific beats impressive.',
  email: 'you@example.com', avatar: '', resume: '', available: '1',
  github: '', linkedin: '', twitter: '', source: '', accent: '#b0451f',
  seo_title: '', seo_description: '', og_image: '',
}
const getSettings = async () => {
  const rows = await all('select key, value from settings')
  return { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])), site: SITE }
}
const setSetting = (k, v) => run('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value', k, v)

/* ---------- live stats, refreshed in the background ---------- */
const STATS_URL = 'https://annie.monster/api/status'
const STATS_TTL = 6 * 3600e3
let refreshing = false

const refreshStats = async () => {
  if (refreshing) return
  refreshing = true
  try {
    const r = await fetch(STATS_URL, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`status ${r.status}`)
    const j = await r.json()
    if (typeof j.guilds !== 'number' || typeof j.users !== 'number') throw new Error('unexpected shape')
    await Promise.all([
      setSetting('stat_servers', String(j.guilds)),
      setSetting('stat_users', String(j.users)),
      setSetting('stat_ping', String(j.ping ?? '')),
      setSetting('stat_at', String(Date.now())),
    ])
  } catch (e) {
    console.warn('stats refresh failed:', e.message)
    await setSetting('stat_at', String(Date.now()))   // back off instead of retrying every request
  } finally {
    refreshing = false
  }
}

// Renders from the stored values so a page never waits on the network. If they are
// stale the refresh runs after the response, and the next visitor sees the new ones.
const shape = (s) => {
  const n = v => Number(v || 0).toLocaleString('en-US')
  return {
    servers: n(s.stat_servers), users: n(s.stat_users), ping: s.stat_ping || '',
    users_k: Math.floor(Number(s.stat_users || 0) / 1000) + 'k',
    raw_servers: Number(s.stat_servers || 0), raw_users: Number(s.stat_users || 0),
  }
}

// Settings are rendered in several places (hero, about, meta tags), so fill them once
// here rather than at each call site.
const withStats = (s, st) => ({ ...s,
  tagline: fill(s.tagline, st), about: fill(s.about, st),
  seo_description: fill(s.seo_description, st), role: fill(s.role, st) })

const statsFor = async (s) => {
  if (Date.now() - Number(s.stat_at || 0) < STATS_TTL) return shape(s)
  // Nothing stored yet (fresh deploy): wait, otherwise the page would print zeros.
  if (!s.stat_servers) { await refreshStats(); return shape(await getSettings()) }
  refreshStats()
  return shape(s)
}

/* ---------- entities: one spec drives list, form, save, delete ---------- */
const ENTITIES = {
  projects: {
    label: 'Projects', singular: 'Project', order: 'position asc, id desc',
    cols: [['title', 'Title'], ['year', 'Year'], ['tags', 'Tags'], ['published', 'Live']],
    fields: [
      { n: 'title', l: 'Title', t: 'text', req: true },
      { n: 'summary', l: 'One-line summary', t: 'text', hint: 'Shown in the work list. Lead with the outcome, not the stack.' },
      { n: 'description', l: 'Full description', t: 'textarea', rows: 8, hint: 'Blank line = new paragraph. **bold** and [text](url) work.' },
      { n: 'image', l: 'Cover image', t: 'image' },
      { n: 'tags', l: 'Tags', t: 'text', hint: 'Comma separated: React, Postgres, Figma' },
      { n: 'link', l: 'Live URL', t: 'text' },
      { n: 'repo', l: 'Repo URL', t: 'text' },
      { n: 'year', l: 'Year', t: 'text' },
      { n: 'slug', l: 'URL slug', t: 'text', hint: 'Leave blank to generate from the title.' },
      { n: 'featured', l: 'Feature on homepage', t: 'bool' },
      { n: 'published', l: 'Published', t: 'bool', def: 1 },
      { n: 'position', l: 'Sort order', t: 'number', hint: 'Lower shows first.' },
    ],
  },
  experience: {
    label: 'Experience', singular: 'Role', order: 'position asc, id desc',
    cols: [['role', 'Role'], ['company', 'Company'], ['period', 'Period']],
    fields: [
      { n: 'role', l: 'Role', t: 'text', req: true },
      { n: 'company', l: 'Company', t: 'text' },
      { n: 'period', l: 'Period', t: 'text', hint: '2023 to present' },
      { n: 'location', l: 'Location', t: 'text' },
      { n: 'description', l: 'What you did', t: 'textarea', rows: 5 },
      { n: 'position', l: 'Sort order', t: 'number' },
    ],
  },
  skills: {
    label: 'Skills', singular: 'Skill group', order: 'position asc, id desc',
    cols: [['label', 'Group'], ['items', 'Items']],
    fields: [
      { n: 'label', l: 'Group name', t: 'text', req: true, hint: 'Frontend, Backend, Infra…' },
      { n: 'items', l: 'Items', t: 'text', hint: 'Comma separated' },
      { n: 'position', l: 'Sort order', t: 'number' },
    ],
  },
}
const rowsOf = e => all(`select * from ${e} order by ${ENTITIES[e].order}`)
const rowById = (e, id) => get(`select * from ${e} where id = ?`, id)

/* ---------- schema + seed ---------- */
const init = async () => {
  if (!TURSO) await client.execute('pragma journal_mode = WAL')   // local file only
  await client.executeMultiple(SCHEMA)
  if ((await get('select count(*) c from projects')).c) return
  const proj = `insert into projects (title,slug,summary,description,tags,year,featured,published,position)
    values (?,?,?,?,?,?,?,1,?)`
  await run(proj, 'Nimbus Analytics', 'nimbus-analytics', 'Realtime dashboard handling 400k events a day',
    'A short case study goes here.\n\nWhat the problem was, what you built, and what changed because of it.', 'Next.js, ClickHouse, D3', '2026', 1, 1)
  await run(proj, 'Fold', 'fold', 'Offline-first notes app that syncs without conflicts',
    'Replace this with a real project from /admin.', 'React, CRDT, IndexedDB', '2025', 1, 2)
  await run(proj, 'Payload', 'payload', 'Self-hosted deploy pipeline for small teams',
    'Replace this with a real project from /admin.', 'Go, Docker', '2025', 0, 3)
  await run('insert into experience (role,company,period,location,description,position) values (?,?,?,?,?,?)',
    'Freelance developer', 'Self-employed', '2024 to present', 'Remote',
    'Shipping products for founders who would rather have a product than a roadmap.', 1)
  for (const [l, i, n] of [['Frontend', 'React, Next.js, TypeScript, Tailwind', 1],
                           ['Backend', 'Node, Python, Postgres, Redis', 2],
                           ['Infra', 'AWS, Docker, CI/CD, Fly.io', 3]])
    await run('insert into skills (label,items,position) values (?,?,?)', l, i, n)
}
let ready
const boot = () => (ready ||= init())

/* ---------- auth: signed cookie, no session store ---------- */
const sign = v => `${v}.${crypto.createHmac('sha256', SECRET).update(v).digest('base64url')}`
const unsign = c => {
  if (!c) return null
  const i = c.lastIndexOf('.')
  if (i < 1) return null
  const v = c.slice(0, i)
  const expect = Buffer.from(sign(v))
  const got = Buffer.from(c)
  return expect.length === got.length && crypto.timingSafeEqual(expect, got) ? v : null
}
const readCookie = (req, name) => (req.headers.cookie || '').split(';')
  .map(s => s.trim().split('=')).find(([k]) => k === name)?.[1]
const authed = req => unsign(readCookie(req, 'sid') && decodeURIComponent(readCookie(req, 'sid'))) === 'admin'
const requireAuth = (req, res, next) => authed(req) ? next() : res.redirect('/admin/login')

/* ---------- uploads ---------- */
const OK_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'])
const filename = f => `${Date.now()}-${slugify(path.parse(f.originalname).name) || 'file'}${path.extname(f.originalname).toLowerCase()}`
const upload = multer({
  storage: BLOB ? multer.memoryStorage() : multer.diskStorage({
    destination: path.join(DATA, 'uploads'),
    filename: (_r, file, cb) => cb(null, filename(file)),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_r, file, cb) => cb(OK_TYPES.has(file.mimetype) ? null : new Error('Images only'), OK_TYPES.has(file.mimetype)),
})

const app = express()
app.set('trust proxy', 1)   // real client IP + req.secure behind a proxy
app.disable('x-powered-by')
app.use(async (_req, _res, next) => { try { await boot() } catch (e) { return next(e) } next() })
app.use(express.urlencoded({ extended: false, limit: '256kb' }))
app.use('/public', express.static(path.join(root, 'public'), { maxAge: '1h' }))
if (!BLOB) app.use('/uploads', express.static(path.join(DATA, 'uploads'), { maxAge: '7d' }))

/* ---------- public site ---------- */
app.get('/', async (req, res) => {
  const raw = await getSettings()
  const stats = await statsFor(raw)
  const s = withStats(raw, stats)
  res.send(homePage({
  s, stats,
  projects: await all('select * from projects where published = 1 order by position asc, id desc'),
  experience: await rowsOf('experience'),
  skills: await rowsOf('skills'),
  sent: 'sent' in req.query,
}))
})

app.get('/work/:slug', async (req, res) => {
  const p = await get('select * from projects where slug = ? and published = 1', req.params.slug)
  const raw = await getSettings()
  if (!p) return res.status(404).send(notFound(raw))
  const s = withStats(raw, await statsFor(raw))
  const list = await all('select slug, title from projects where published = 1 order by position asc, id desc')
  const i = list.findIndex(x => x.slug === p.slug)
  res.send(projectPage({ s, p, stats: await statsFor(raw), next: list.length > 1 ? list[(i + 1) % list.length] : null }))
})

app.get('/robots.txt', (_req, res) => res.type('text/plain')
  .send(`User-agent: *\nDisallow: /admin\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`))

app.get('/sitemap.xml', async (_req, res) => {
  const slugs = await all('select slug from projects where published = 1')
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><priority>1.0</priority></url>
${slugs.map(r => `  <url><loc>${SITE}/work/${r.slug}</loc><priority>0.8</priority></url>`).join('\n')}
</urlset>`)
})

// in-memory, resets on restart
const hits = new Map()
app.post('/contact', async (req, res) => {
  const ip = req.ip
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600e3)
  if (recent.length >= 5) return res.status(429).send('Too many messages. Try again later.')
  hits.set(ip, [...recent, now])

  const name = String(req.body.name || '').trim().slice(0, 120)
  const email = String(req.body.email || '').trim().slice(0, 200)
  const body = String(req.body.body || '').trim().slice(0, 5000)
  if (req.body.website) return res.redirect('/?sent#contact')          // honeypot
  if (!body || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).send('Please give a valid email and a message.')
  await run('insert into messages (name,email,body,created) values (?,?,?,?)', name, email, body, new Date().toISOString())
  res.redirect('/?sent#contact')
})

/* ---------- admin ---------- */
app.get('/admin/login', (req, res) => authed(req) ? res.redirect('/admin') : res.send(loginPage({})))
app.post('/admin/login', (req, res) => {
  const given = crypto.createHash('sha256').update(String(req.body.password || '')).digest()
  const want = crypto.createHash('sha256').update(PASSWORD).digest()
  if (!crypto.timingSafeEqual(given, want)) return res.status(401).send(loginPage({ error: 'Wrong password.' }))
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sign('admin'))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${req.secure ? '; Secure' : ''}`)
  res.redirect('/admin')
})
app.post('/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
  res.redirect('/admin/login')
})

app.use('/admin', requireAuth)

const counts = async () => {
  const [p, e, k, u] = await Promise.all([
    get('select count(*) c from projects'), get('select count(*) c from experience'),
    get('select count(*) c from skills'), get('select count(*) c from messages where seen = 0'),
  ])
  return { projects: p.c, experience: e.c, skills: k.c, unread: u.c }
}

app.get('/admin', (_req, res) => res.redirect('/admin/projects'))

app.post('/admin/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ url: null })
  if (!BLOB) return res.json({ url: `/uploads/${req.file.filename}` })
  const { url } = await put(filename(req.file), req.file.buffer,
    { access: 'public', contentType: req.file.mimetype, addRandomSuffix: true })
  res.json({ url })
})

app.get('/admin/settings', async (req, res) =>
  res.send(adminSettings({ s: await getSettings(), counts: await counts(), saved: 'saved' in req.query })))
const BOOL_SETTINGS = new Set(['available'])
app.post('/admin/settings', async (req, res) => {
  for (const k of Object.keys(DEFAULTS)) {
    // absent checkbox means off; an absent text field means it wasn't on this form
    if (BOOL_SETTINGS.has(k)) await setSetting(k, req.body[k] ? '1' : '0')
    else if (k in req.body) await setSetting(k, String(req.body[k]).slice(0, 8000))
  }
  res.redirect('/admin/settings?saved')
})

app.get('/admin/messages', async (_req, res) =>
  res.send(adminInbox({ messages: await all('select * from messages order by id desc'), counts: await counts() })))
app.post('/admin/messages/:id/seen', async (req, res) => {
  await run('update messages set seen = 1 - seen where id = ?', Number(req.params.id))
  res.redirect('/admin/messages')
})
app.post('/admin/messages/:id/delete', async (req, res) => {
  await run('delete from messages where id = ?', Number(req.params.id))
  res.redirect('/admin/messages')
})

app.param('entity', (req, res, next, e) => ENTITIES[e] ? next() : res.status(404).send('Unknown section'))

app.get('/admin/:entity', async (req, res) => res.send(adminList({
  key: req.params.entity, spec: ENTITIES[req.params.entity],
  rows: await rowsOf(req.params.entity), counts: await counts(),
})))

app.get('/admin/:entity/new', async (req, res) => res.send(adminForm({
  key: req.params.entity, spec: ENTITIES[req.params.entity], row: {}, counts: await counts(),
})))

app.get('/admin/:entity/:id', async (req, res) => {
  const row = await rowById(req.params.entity, Number(req.params.id))
  if (!row) return res.redirect(`/admin/${req.params.entity}`)
  res.send(adminForm({ key: req.params.entity, spec: ENTITIES[req.params.entity], row, counts: await counts() }))
})

app.post('/admin/:entity/:id/delete', async (req, res) => {
  await run(`delete from ${req.params.entity} where id = ?`, Number(req.params.id))
  res.redirect(`/admin/${req.params.entity}`)
})

app.post('/admin/:entity/:id?', async (req, res) => {
  const key = req.params.entity
  const spec = ENTITIES[key]
  const data = {}
  for (const f of spec.fields) {
    const raw = req.body[f.n]
    data[f.n] = f.t === 'bool' ? (raw ? 1 : 0)
      : f.t === 'number' ? (Number.parseInt(raw, 10) || 0)
        : String(raw ?? '').slice(0, 20000)
  }
  if (key === 'projects') {
    data.slug = slugify(data.slug || data.title) || `project-${Date.now()}`
    let n = 1
    while (await get('select id from projects where slug = ? and id is not ?', data.slug, req.params.id ? Number(req.params.id) : null)) {
      data.slug = `${data.slug.replace(/-\d+$/, '')}-${++n}`
    }
  }
  const cols = Object.keys(data)
  const vals = cols.map(c => data[c])
  if (req.params.id) {
    await run(`update ${key} set ${cols.map(c => `${c} = ?`).join(', ')} where id = ?`, ...vals, Number(req.params.id))
  } else {
    await run(`insert into ${key} (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`, ...vals)
  }
  res.redirect(`/admin/${key}`)
})

app.use(async (_req, res) => res.status(404).send(notFound(await getSettings())))
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(400).send(`<p style="font:16px system-ui;padding:40px">${err.message}</p><p style="font:16px system-ui;padding:0 40px"><a href="javascript:history.back()">Go back</a></p>`)
})

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`\n  site   http://localhost:${PORT}\n  admin  http://localhost:${PORT}/admin\n`))
}

export default app
