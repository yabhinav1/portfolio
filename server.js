import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { put } from '@vercel/blob'
import { slugify, SCHEMA } from './lib.js'
import { homePage, projectPage, notFound } from './views/site.js'
import { adminList, adminForm, adminSettings, adminInbox, loginPage } from './views/admin.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin'
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
const SITE = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '')
const DATA = process.env.DATA_DIR || root
const TURSO = !!process.env.TURSO_DATABASE_URL
// A Blob store connected over OIDC sets BLOB_STORE_ID but no read-write token, so
// checking only for the token would fall back to disk — which is read-only on Vercel.
const BLOB = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL)
// Serverless filesystems are read-only, so only touch disk when we're actually using it.
if (!BLOB) fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true })
if (!process.env.ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD not set — using "admin". Set it before deploying.')

/* ---------- db ---------- */
// libSQL *is* SQLite, so schema and queries are unchanged — only the driver and the
// sync/async boundary differ. file: locally, Turso in production.
const client = createClient(TURSO
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: `file:${path.join(DATA, 'portfolio.db')}` })

const all = (sql, ...args) => client.execute({ sql, args }).then(r => r.rows)
const get = (sql, ...args) => all(sql, ...args).then(r => r[0])
const run = (sql, ...args) => client.execute({ sql, args })

const DEFAULTS = {
  name: 'Your Name', role: 'Full-stack developer', location: 'Bengaluru, India',
  tagline: 'I build web products end to end — from the first sketch to the deploy.',
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

/* ---------- entity specs: one table-driven admin instead of three hand-written CRUDs ---------- */
const ENTITIES = {
  projects: {
    label: 'Projects', singular: 'Project', order: 'position asc, id desc',
    cols: [['title', 'Title'], ['year', 'Year'], ['tags', 'Tags'], ['published', 'Live']],
    fields: [
      { n: 'title', l: 'Title', t: 'text', req: true },
      { n: 'summary', l: 'One-line summary', t: 'text', hint: 'Shown in the work list. Lead with the outcome, not the stack.' },
      { n: 'description', l: 'Full description', t: 'textarea', rows: 8, hint: 'Blank line = new paragraph. **bold** and [text](url) work.' },
      { n: 'image', l: 'Cover image', t: 'image' },
      { n: 'tags', l: 'Tags', t: 'text', hint: 'Comma separated — React, Postgres, Figma' },
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
      { n: 'period', l: 'Period', t: 'text', hint: '2023 — Present' },
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

/* ---------- schema + seed, once per cold start ---------- */
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
    'Freelance developer', 'Self-employed', '2024 — Present', 'Remote',
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
app.set('trust proxy', 1)   // Fly/Cloudflare terminate TLS; without this req.ip is the proxy for everyone
app.disable('x-powered-by')
app.use(async (_req, _res, next) => { try { await boot() } catch (e) { return next(e) } next() })
app.use(express.urlencoded({ extended: false, limit: '256kb' }))
app.use('/public', express.static(path.join(root, 'public'), { maxAge: '1h' }))
if (!BLOB) app.use('/uploads', express.static(path.join(DATA, 'uploads'), { maxAge: '7d' }))

/* ---------- public site ---------- */
app.get('/', async (req, res) => res.send(homePage({
  s: await getSettings(),
  projects: await all('select * from projects where published = 1 order by position asc, id desc'),
  experience: await rowsOf('experience'),
  skills: await rowsOf('skills'),
  sent: 'sent' in req.query,
})))

app.get('/work/:slug', async (req, res) => {
  const p = await get('select * from projects where slug = ? and published = 1', req.params.slug)
  const s = await getSettings()
  if (!p) return res.status(404).send(notFound(s))
  const list = await all('select slug, title from projects where published = 1 order by position asc, id desc')
  const i = list.findIndex(x => x.slug === p.slug)
  res.send(projectPage({ s, p, next: list.length > 1 ? list[(i + 1) % list.length] : null }))
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

// ponytail: in-memory rate limit, resets on restart. Swap for a table if you ever get real spam.
const hits = new Map()
app.post('/contact', async (req, res) => {
  const ip = req.ip
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600e3)
  if (recent.length >= 5) return res.status(429).send('Too many messages — try again later.')
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
  res.json({ url })   // absolute Blob URL; abs() in views/site.js leaves it alone
})

app.get('/admin/settings', async (req, res) =>
  res.send(adminSettings({ s: await getSettings(), counts: await counts(), saved: 'saved' in req.query })))
const BOOL_SETTINGS = new Set(['available'])
app.post('/admin/settings', async (req, res) => {
  for (const k of Object.keys(DEFAULTS)) {
    // unchecked box is absent from the body, so bools must be written either way; a text
    // field that is absent means "not on this form" — writing '' would silently erase it.
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
