import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { put, get as blobGet } from '@vercel/blob'
import { Readable } from 'node:stream'
import { esc, slugify, fill, SCHEMA, addColumns, parseContributions, streaks } from './lib.js'
import { notifyNew, sendMail } from './notify.js'
import { homePage, projectPage, notFound, notesPage, notePage, resumePage, SCRIPT } from './views/site.js'
import { adminList, adminForm, adminSettings, adminInbox, loginPage } from './views/admin.js'

const here = fileURLToPath(import.meta.url)
const root = path.dirname(here)
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
  name: 'Your Name', role: 'Full-stack developer', location: 'Bengaluru, India', timezone: '', now: '',
  tagline: 'I build web products end to end, from the first sketch to the deploy.',
  about: 'Replace this in /admin → Settings.\n\nWrite two short paragraphs about how you work and what you care about. Specific beats impressive.',
  email: 'you@example.com', avatar: '', resume: '', available: '1',
  github: '', linkedin: '', twitter: '', source: '', accent: '#b0451f',
  seo_title: '', seo_description: '', og_image: '',
  education: '', headline: '',
}
// Local /uploads/ paths stop existing once uploads live in Blob storage, so a stale
// value would mean a broken link preview or avatar. Treat it as unset instead.
const usable = u => (BLOB && /^\/uploads\//.test(u || '')) ? '' : (u || '')
const getSettings = async () => {
  const rows = await all('select key, value from settings')
  const s = { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value])), site: SITE }
  s.og_image = usable(s.og_image)
  s.avatar = usable(s.avatar)
  return s
}
const setSetting = (k, v) => run('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value', k, v)

/* ---------- rate limiting, stored in the database ----------
   An in-memory map is useless on serverless, where each request may land on a fresh
   process. One small table instead: key -> JSON list of recent timestamps. */
const limited = async (key, max, windowMs) => {
  const now = Date.now()
  const row = await get('select times from hits where key = ?', key)
  const recent = (row ? JSON.parse(row.times) : []).filter(t => now - t < windowMs)
  if (recent.length >= max) return true
  recent.push(now)
  await run('insert into hits(key,times,last) values(?,?,?) on conflict(key) do update set times=excluded.times, last=excluded.last',
    key, JSON.stringify(recent), now)
  if (Math.random() < 0.02) await run('delete from hits where last < ?', now - 86400e3)   // occasional sweep
  return false
}

/* ---------- live stats ----------
   Refreshed at most every STATS_TTL. A stale value is refreshed inline, in the request
   that finds it stale, with a short timeout: that costs one visitor a few hundred
   milliseconds every six hours, and it works the same on a server and on serverless,
   where work left running after the response may never finish. */
const STATS_URL = 'https://www.annie.monster/api/status'
const STATS_TTL = 6 * 3600e3
const STATS_RETRY = 15 * 60e3
let refreshing = null

const refreshStats = () => refreshing ||= (async () => {
  try {
    // Annie's status API sits behind a captcha gate. ANNIE_STATS_KEY is the shared key
    // (STATS_API_KEY on Annie's side) that lets a server read the public summary.
    const key = (process.env.ANNIE_STATS_KEY || '').trim()   // a pasted value often carries a newline
    const headers = key ? { 'x-annie-stats-key': key } : {}
    const r = await fetch(STATS_URL, { headers, signal: AbortSignal.timeout(4000) })
    if (!r.ok) throw new Error(`status ${r.status} ${(await r.text()).slice(0, 80)}${key ? '' : ' (ANNIE_STATS_KEY is not set)'}`)
    const j = await r.json()
    if (typeof j.guilds !== 'number' || typeof j.users !== 'number') throw new Error('unexpected shape')
    await Promise.all([
      setSetting('stat_servers', String(j.guilds)),
      setSetting('stat_users', String(j.users)),
      setSetting('stat_ping', String(j.ping ?? '')),
      setSetting('stat_at', String(Date.now())),
      setSetting('stat_err', ''),
    ])
  } catch (e) {
    console.warn('stats refresh failed:', e.message)
    // Back off, but only for STATS_RETRY, not a whole TTL: a fixed key or a recovered
    // API should show up within minutes, not hours. The error is kept for the admin.
    await Promise.all([
      setSetting('stat_at', String(Date.now() - STATS_TTL + STATS_RETRY)),
      setSetting('stat_err', `${new Date().toISOString()} ${e.message}`),
    ])
  } finally {
    refreshing = null
  }
})()

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
  tagline: fill(s.tagline, st), about: fill(s.about, st), now: fill(s.now, st),
  seo_description: fill(s.seo_description, st), role: fill(s.role, st) })

const statsFor = async (s) => {
  if (Date.now() - Number(s.stat_at || 0) < STATS_TTL) return shape(s)
  await refreshStats()
  return shape(await getSettings())
}

// Settings plus stats, resolved once per request.
const context = async () => {
  const [raw, note] = await Promise.all([getSettings(), get('select 1 as x from notes where published = 1 limit 1')])
  const stats = await statsFor(raw)
  return { s: { ...withStats(raw, stats), has_notes: !!note }, stats }
}

/* ---------- GitHub activity, same cache pattern as the stats ----------
   The public calendar at github.com/users/<name>/contributions needs no token. The
   user comes from the GitHub link in settings, so there is nothing extra to configure. */
const ghUser = s => (s.github || '').match(/github\.com\/([\w.-]+)/)?.[1] || ''
let ghRefreshing = null
const refreshGithub = (user) => ghRefreshing ||= (async () => {
  try {
    const r = await fetch(`https://github.com/users/${user}/contributions`,
      { headers: { 'user-agent': 'Mozilla/5.0 (portfolio; +' + SITE + ')' }, signal: AbortSignal.timeout(6000) })
    if (!r.ok) throw new Error(`status ${r.status}`)
    const { days, total } = parseContributions(await r.text())
    if (!days.length) throw new Error('no calendar in page')
    await Promise.all([
      setSetting('gh_days', JSON.stringify(days.map(x => [x.d, x.n, x.l]))),
      setSetting('gh_total', String(total)),
      setSetting('gh_user', user),
      setSetting('gh_at', String(Date.now())),
      setSetting('gh_err', ''),
    ])
  } catch (e) {
    console.warn('github refresh failed:', e.message)
    await Promise.all([
      setSetting('gh_at', String(Date.now() - STATS_TTL + STATS_RETRY)),
      setSetting('gh_err', `${new Date().toISOString()} ${e.message}`),
    ])
  } finally {
    ghRefreshing = null
  }
})()
const githubFor = async (s) => {
  const user = ghUser(s)
  if (!user) return null
  if (Date.now() - Number(s.gh_at || 0) >= STATS_TTL || s.gh_user !== user) {
    await refreshGithub(user)
    s = await getSettings()
  }
  if (!s.gh_days || s.gh_user !== user) return null
  const days = JSON.parse(s.gh_days).map(([d, n, l]) => ({ d, n, l }))
  return { user, days, total: Number(s.gh_total || 0), ...streaks(days) }
}

/* ---------- live status of each project's site, cached for 10 minutes ----------
   One request per live URL, in parallel, with a short timeout; the visitor who finds
   the cache stale pays for it. Annie reports its own gateway ping, so that is used
   when the stats are fresh. */
const LIVE_TTL = 10 * 60e3
let liveRefreshing = null
const refreshLive = (projects) => liveRefreshing ||= (async () => {
  try {
    const out = {}
    await Promise.all(projects.filter(p => /^https?:\/\//.test(p.link || '')).map(async p => {
      const t = Date.now()
      try {
        const r = await fetch(p.link, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(4000),
          headers: { 'user-agent': 'Mozilla/5.0 (portfolio status check; +' + SITE + ')' } })
        out[p.slug] = { up: r.status < 500, ms: Date.now() - t, code: r.status }
      } catch { out[p.slug] = { up: false, ms: null } }
    }))
    await Promise.all([setSetting('live_status', JSON.stringify(out)), setSetting('live_at', String(Date.now()))])
  } finally { liveRefreshing = null }
})()
const liveFor = async (s, projects) => {
  if (Date.now() - Number(s.live_at || 0) >= LIVE_TTL) { await refreshLive(projects); s = await getSettings() }
  let st = {}
  try { st = JSON.parse(s.live_status || '{}') } catch {}
  // Annie's own gateway latency is the honest number for a bot
  const annie = projects.find(p => /annie/i.test(p.slug))
  if (annie && st[annie.slug]?.up && s.stat_ping && Date.now() - Number(s.stat_at || 0) < STATS_TTL) st[annie.slug] = { ...st[annie.slug], ms: Number(s.stat_ping), label: 'gateway' }
  return st
}

/* ---------- "last shipped": the newest push on GitHub, cached for an hour ---------- */
const SHIP_TTL = 3600e3
const shippedFor = async (s) => {
  const user = ghUser(s)
  if (!user) return null
  if (Date.now() - Number(s.ship_at || 0) >= SHIP_TTL) {
    // GitHub's events no longer carry commit messages, so: the most recently pushed
    // public repo, then its newest commit that is not housekeeping.
    const gh = path => fetch(`https://api.github.com${path}`, {
      headers: { 'user-agent': 'portfolio', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(4000) })
    try {
      const rr = await gh(`/users/${user}/repos?sort=pushed&per_page=6`)
      if (!rr.ok) throw new Error(`repos ${rr.status}`)
      const repo = (await rr.json()).find(r => !r.fork && !r.archived && r.name !== user)
      if (repo) {
        const cr = await gh(`/repos/${user}/${repo.name}/commits?per_page=10`)
        if (!cr.ok) throw new Error(`commits ${cr.status}`)
        // Skip housekeeping and the commits my own workflows make (PDF refresh, backups, keepalives).
        const c = (await cr.json()).find(c => !/^(Merge|Record |Stats:|Harvest|Topic:|Redeploy|Refresh résumé PDF|Backup |Keep the |Scheduled post|Audit:)/.test(c.commit.message))
        if (c) await setSetting('ship', JSON.stringify({ repo: repo.name, url: c.html_url,
          msg: c.commit.message.split('\n')[0].slice(0, 90), at: c.commit.author.date }))
      }
    } catch (e) { console.warn('last shipped failed:', e.message) }
    await setSetting('ship_at', String(Date.now()))
    s = await getSettings()
  }
  try { return JSON.parse(s.ship || 'null') } catch { return null }
}

// What the admin sees about the two feeds: last update, or the last error.
const feedStatus = s => ({
  stats: { ok: !!s.stat_servers && !s.stat_err, at: Number(s.stat_at || 0), err: s.stat_err || '',
    text: s.stat_servers ? `${shape(s).servers} servers, ${shape(s).users} users` : 'nothing fetched yet' },
  github: { ok: !!s.gh_days && !s.gh_err, at: Number(s.gh_at || 0), err: s.gh_err || '',
    text: s.gh_days ? `${Number(s.gh_total || 0).toLocaleString('en-US')} contributions for @${s.gh_user}` : (ghUser(s) ? 'nothing fetched yet' : 'no GitHub link set') },
})

/* ---------- entities: one spec drives list, form, save, delete ---------- */
const MD_HINT = 'Blank line = new paragraph. **bold**, *italic*, `code`, [text](url), ## headings, - lists, ```code blocks``` and ![caption](image-url) on its own line all work.'
const ENTITIES = {
  projects: {
    label: 'Projects', singular: 'Project', order: 'position asc, id desc',
    cols: [['title', 'Title'], ['year', 'Year'], ['tags', 'Tags'], ['published', 'Live']],
    fields: [
      { n: 'title', l: 'Title', t: 'text', req: true },
      { n: 'summary', l: 'One-line summary', t: 'text', hint: 'Shown in the work list. Lead with the outcome, not the stack.' },
      { n: 'description', l: 'Full description', t: 'textarea', rows: 14, hint: MD_HINT },
      { n: 'image', l: 'Cover image', t: 'image' },
      { n: 'tags', l: 'Tags', t: 'text', hint: 'Comma separated: React, Postgres, Figma' },
      { n: 'link', l: 'Live URL', t: 'text' },
      { n: 'embed', l: 'Show the live site in previews', t: 'bool', hint: 'Runs the Live URL in the hover preview and on the project page, in place of the cover. Only works for sites that allow embedding (no X-Frame-Options).' },
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
      { n: 'description', l: 'What you did', t: 'textarea', rows: 5, hint: MD_HINT },
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
  // Short write-ups, mostly the LinkedIn posts: the queue adds each one here when it
  // publishes, so the writing also lives on this domain.
  notes: {
    label: 'Notes', singular: 'Note', order: 'published_at desc, id desc',
    cols: [['title', 'Title'], ['published_at', 'Date'], ['published', 'Live']],
    fields: [
      { n: 'title', l: 'Title', t: 'text', req: true, hint: 'Usually the post\'s first line.' },
      { n: 'body', l: 'Text', t: 'textarea', rows: 16, hint: MD_HINT },
      { n: 'image', l: 'Image', t: 'image' },
      { n: 'linkedin_url', l: 'LinkedIn post URL', t: 'text', hint: 'Shown as “Discuss on LinkedIn”. Blank hides it.' },
      { n: 'published_at', l: 'Date', t: 'text', hint: 'YYYY-MM-DD. Newest shows first.' },
      { n: 'slug', l: 'URL slug', t: 'text', hint: 'Leave blank to generate from the title.' },
      { n: 'published', l: 'Published', t: 'bool', def: 1 },
    ],
  },
}
const rowsOf = e => all(`select * from ${e} order by ${ENTITIES[e].order}`)
const rowById = (e, id) => get(`select * from ${e} where id = ?`, id)
const PUBLISHED = 'select * from projects where published = 1 order by position asc, id desc'

/* ---------- schema + seed ---------- */
const init = async () => {
  if (!TURSO) await client.execute('pragma journal_mode = WAL')   // local file only
  await client.executeMultiple(SCHEMA)
  await addColumns(client)
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

/* ---------- security headers ----------
   The public pages carry two inline scripts, allowed by their hashes, so nothing else
   can run. The admin uses inline handlers (confirm dialogs), so it keeps 'unsafe-inline'
   but sits behind the login. Images may come from any https URL because the admin
   accepts pasted image links. */
const SCRIPT_HASHES = Object.values(SCRIPT)
  .map(js => `'sha256-${crypto.createHash('sha256').update(js).digest('base64')}'`).join(' ')
const csp = admin => [
  "default-src 'self'",
  `script-src ${admin ? "'self' 'unsafe-inline'" : SCRIPT_HASHES}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' https: data:${admin ? ' blob:' : ''}`,
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  // projects marked "show the live site" are embedded from their own domains
  `frame-src ${admin ? "'self'" : "'self' https:"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

const app = express()
app.set('trust proxy', 1)   // real client IP + req.secure behind a proxy
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.set(HEADERS)
  res.set('Content-Security-Policy', csp(req.path.startsWith('/admin')))
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=63072000')
  next()
})
app.use(async (_req, _res, next) => { try { await boot() } catch (e) { return next(e) } next() })
app.use(express.urlencoded({ extended: false, limit: '256kb' }))
app.use('/public', express.static(path.join(root, 'public'), { maxAge: '365d', immutable: true }))
if (!BLOB) app.use('/uploads', express.static(path.join(DATA, 'uploads'), { maxAge: '7d' }))

// Uploaded images live in a private Blob store. Names carry a random suffix, so a URL
// never changes content and can be cached for a year.
app.get('/media/*', async (req, res, next) => {
  const name = req.params[0]
  if (!BLOB || !/^[\w.-]+$/.test(name)) return next()
  try {
    const r = await blobGet(name, { access: 'private' })
    if (!r || r.statusCode !== 200) return next()
    res.set({ 'Content-Type': r.blob.contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' })
    if (r.blob.contentType === 'image/svg+xml') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
    Readable.fromWeb(r.stream).pipe(res)
  } catch (e) {
    console.error('media failed:', e.message)
    next()
  }
})

/* ---------- visits from LinkedIn ----------
   Each LinkedIn post's first comment links here with ?ref=li-<post id>, so the
   clicks each post brings in can be counted. Visits with a LinkedIn referrer but
   no ref count as "linkedin". Counts only: no IPs, no cookies, nothing personal. */
const refSource = req => {
  const ref = String(req.query.ref || '')
  if (/^li-[a-z0-9-]{1,80}$/i.test(ref)) return ref.toLowerCase()
  const from = String(req.headers.referer || '')
  if (/^https?:\/\/([\w-]+\.)*(linkedin\.com|lnkd\.in)\//i.test(from)) return 'linkedin'
  return null
}
app.use(async (req, _res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/admin') || req.path.startsWith('/public') || req.path.startsWith('/badge') || req.path.startsWith('/stats')) return next()
  const src = refSource(req)
  if (src && !/bot|crawl|spider|preview|linkedinbot/i.test(req.headers['user-agent'] || '')) {
    await run('insert into referrals(day, source, n) values(?,?,1) on conflict(day, source) do update set n = n + 1',
      new Date().toISOString().slice(0, 10), src).catch(e => console.warn('referral count failed:', e.message))
  }
  next()
})
app.get('/stats/linkedin.json', async (_req, res) => {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const rows = await all("select day, source, n from referrals where day >= ? and (source = 'linkedin' or source like 'li-%') order by day", since)
  const days = {}, refs = {}
  for (const r of rows) {
    days[r.day] = (days[r.day] || 0) + Number(r.n)
    if (r.source !== 'linkedin') refs[r.source] = (refs[r.source] || 0) + Number(r.n)
  }
  res.set('Cache-Control', 'public, max-age=300').json({ since, days, refs })
})

/* ---------- public site ---------- */
const NOTES = "select * from notes where published = 1 order by published_at desc, id desc"

app.get('/', async (req, res) => {
  const { s, stats } = await context()
  const projects = await all(PUBLISHED)
  const [experience, skills, github, live, shipped, notes] = await Promise.all([
    rowsOf('experience'), rowsOf('skills'), githubFor(s), liveFor(s, projects), shippedFor(s), all(NOTES)])
  res.send(homePage({
    s, stats, projects, experience, skills, github, live, shipped, notes,
    // link preview: the configured image, else the first project that has one
    image: s.og_image || s.avatar || projects.find(p => p.image)?.image || '',
    sent: 'sent' in req.query,
  }))
})

app.get('/notes', async (_req, res) => {
  const { s } = await context()
  res.send(notesPage({ s, notes: await all(NOTES), projects: await all(PUBLISHED) }))
})
app.get('/notes/:slug', async (req, res) => {
  const note = await get('select * from notes where slug = ? and published = 1', req.params.slug)
  const { s, stats } = await context()
  if (!note) return res.status(404).send(notFound(s, await all(PUBLISHED), stats))
  const list = await all(NOTES)
  const i = list.findIndex(x => x.slug === note.slug)
  res.send(notePage({ s, note, next: list[i + 1] || null, prev: list[i - 1] || null, projects: await all(PUBLISHED) }))
})

// The résumé is built from the same content as the site, so it is never out of date.
app.get('/resume', async (req, res) => {
  const { s, stats } = await context()
  const [projects, experience, skills] = await Promise.all([all(PUBLISHED), rowsOf('experience'), rowsOf('skills')])
  res.send(resumePage({ s, stats, projects, experience, skills, print: 'print' in req.query }))
})

app.get('/work/:slug', async (req, res) => {
  const p = await get('select * from projects where slug = ? and published = 1', req.params.slug)
  if (!p) { const c = await context(); return res.status(404).send(notFound(c.s, await all(PUBLISHED), c.stats)) }
  const { s, stats } = await context()
  const list = await all('select slug, title from projects where published = 1 order by position asc, id desc')
  const i = list.findIndex(x => x.slug === p.slug)
  res.send(projectPage({ s, p, stats, all: list, next: list.length > 1 ? list[(i + 1) % list.length] : null }))
})

/* ---------- live stats as an SVG badge, for the GitHub profile README ----------
   GitHub proxies README images and honours short cache lifetimes, so the profile
   shows the same numbers as the site. ?theme=light for a white background. */
app.get('/badge/stats.svg', async (req, res) => {
  const { stats } = await context()
  const dark = req.query.theme !== 'light'
  const bg = dark ? '#0a0a0a' : '#ffffff', ink = dark ? '#f2f2f2' : '#0a0a0a'
  const mut = dark ? '#8a8a8a' : '#6f6f6f', line = dark ? '#262626' : '#dcdcdc', accent = dark ? '#7ea2ff' : '#1a4fd6'
  const parts = stats.raw_servers
    ? [[stats.servers, 'servers running Annie'], [stats.users, 'users reached']]
    : [['Annie', 'live stats unavailable']]
  // ~8.4px per character at this size, which is close enough for a badge
  const w = 40 + parts.reduce((n, [v, l]) => n + (v.length + l.length + 1) * 8.4 + 28, 0)
  let x = 20
  const text = parts.map(([v, l]) => {
    const t = `<text x="${x}" y="27" font-weight="600" fill="${ink}">${esc(v)}</text><text x="${x + v.length * 8.4 + 6}" y="27" fill="${mut}">${esc(l)}</text>`
    x += (v.length + l.length + 1) * 8.4 + 28
    return t
  }).join('')
  res.set('Cache-Control', 'public, max-age=1800').type('image/svg+xml').send(
`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="44" viewBox="0 0 ${Math.round(w)} 44" role="img" aria-label="${esc(parts.map(p => p.join(' ')).join(', '))}">
<rect x=".5" y=".5" width="${Math.round(w) - 1}" height="43" fill="${bg}" stroke="${line}"/>
<circle cx="${Math.round(w) - 18}" cy="22" r="3" fill="${accent}"/>
<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="14">${text}</g>
</svg>`)
})

app.get('/robots.txt', (_req, res) => res.type('text/plain')
  .send(`User-agent: *\nDisallow: /admin\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`))

app.get('/sitemap.xml', async (_req, res) => {
  const slugs = await all('select slug from projects where published = 1')
  const notes = await all('select slug from notes where published = 1')
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><priority>1.0</priority></url>
  <url><loc>${SITE}/resume</loc><priority>0.7</priority></url>
${slugs.map(r => `  <url><loc>${SITE}/work/${r.slug}</loc><priority>0.8</priority></url>`).join('\n')}
${notes.length ? `  <url><loc>${SITE}/notes</loc><priority>0.6</priority></url>\n` : ''}${notes.map(r => `  <url><loc>${SITE}/notes/${r.slug}</loc><priority>0.6</priority></url>`).join('\n')}
</urlset>`)
})

app.post('/contact', async (req, res) => {
  if (await limited(`contact:${req.ip}`, 5, 3600e3)) return res.status(429).send('Too many messages. Try again later.')
  const name = String(req.body.name || '').trim().slice(0, 120)
  const email = String(req.body.email || '').trim().slice(0, 200)
  const body = String(req.body.body || '').trim().slice(0, 5000)
  if (req.body.website) return res.redirect('/?sent#contact')          // honeypot
  if (!body || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).send('Please give a valid email and a message.')
  await run('insert into messages (name,email,body,created) values (?,?,?,?)', name, email, body, new Date().toISOString())
  await notifyNew({ name, email, body })      // never throws; a failed ping must not lose the message
  res.redirect('/?sent#contact')
})

/* ---------- admin ---------- */
app.get('/admin/login', (req, res) => authed(req) ? res.redirect('/admin') : res.send(loginPage({})))
app.post('/admin/login', async (req, res) => {
  // one password on a public URL: cap attempts per address
  if (await limited(`login:${req.ip}`, 10, 15 * 60e3)) {
    return res.status(429).send(loginPage({ error: 'Too many attempts. Try again in 15 minutes.' }))
  }
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

// Everything the site is made of, as one JSON file: the weekly backup downloads this.
app.get('/admin/export.json', async (_req, res) => {
  const tables = {}
  for (const t of ['settings', 'projects', 'experience', 'skills', 'notes', 'messages', 'referrals']) tables[t] = await all(`select * from ${t}`)
  // image URLs referenced anywhere, so a backup can fetch the files too
  const images = [...new Set((JSON.stringify(tables).match(/https:\/\/[\w.-]+\.blob\.vercel-storage\.com\/[^"\s)\\]+|\/media\/[\w.-]+/g) || [])
    .map(u => u.startsWith('/') ? SITE + u : u))]
  res.set('Cache-Control', 'no-store').json({ exported_at: new Date().toISOString(), site: SITE, tables, images })
})

const counts = async () => {
  const [p, e, k, u, nt] = await Promise.all([
    get('select count(*) c from projects'), get('select count(*) c from experience'),
    get('select count(*) c from skills'), get('select count(*) c from messages where seen = 0'),
    get('select count(*) c from notes'),
  ])
  return { projects: p.c, experience: e.c, skills: k.c, unread: u.c, notes: nt.c }
}

app.get('/admin', (_req, res) => res.redirect('/admin/projects'))

app.post('/admin/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ url: null })
  if (!BLOB) return res.json({ url: `/uploads/${req.file.filename}` })
  // The Blob store is private, so files are served back through /media/ below.
  try {
    const { pathname } = await put(filename(req.file), req.file.buffer,
      { access: 'private', contentType: req.file.mimetype, addRandomSuffix: true })
    res.json({ url: `/media/${pathname}` })
  } catch (e) {
    console.error('upload failed:', e.message)
    res.status(500).json({ url: null, error: e.message })
  }
})

app.get('/admin/settings', async (req, res) => {
  const s = await getSettings()
  res.send(adminSettings({ s, counts: await counts(), saved: 'saved' in req.query, feeds: feedStatus(s) }))
})
// Fetch both feeds right now, whatever their age, then show the result.
app.post('/admin/feeds/refresh', async (_req, res) => {
  await setSetting('ship_at', '0')
  const s = await getSettings()
  await Promise.all([refreshStats(), ghUser(s) ? refreshGithub(ghUser(s)) : null, shippedFor(s)])
  res.redirect('/admin/settings')
})
const BOOL_SETTINGS = new Set(['available'])
app.post('/admin/settings', async (req, res) => {
  for (const k of Object.keys(DEFAULTS)) {
    // absent checkbox means off; an absent text field means it wasn't on this form
    if (BOOL_SETTINGS.has(k)) await setSetting(k, req.body[k] ? '1' : '0')
    else if (k in req.body) await setSetting(k, String(req.body[k]).slice(0, 8000))
  }
  res.redirect('/admin/settings?saved')
})

app.get('/admin/messages', async (req, res) =>
  res.send(adminInbox({ messages: await all('select * from messages order by id desc'),
    counts: await counts(), sent: 'sent' in req.query })))
app.post('/admin/messages/:id/seen', async (req, res) => {
  await run('update messages set seen = 1 - seen where id = ?', Number(req.params.id))
  res.redirect('/admin/messages')
})
app.post('/admin/messages/:id/reply', async (req, res) => {
  const id = Number(req.params.id)
  const m = await get('select * from messages where id = ?', id)
  const text = String(req.body.reply || '').trim().slice(0, 5000)
  if (!m || !text) return res.redirect('/admin/messages')
  const s = await getSettings()
  try {
    const sent = await sendMail({
      to: m.email,
      replyTo: s.email || undefined,
      subject: `Re: your message to ${s.name || 'me'}`,
      text,
    })
    if (!sent) return res.send(adminInbox({
      messages: await all('select * from messages order by id desc'), counts: await counts(),
      error: 'Email is not configured. Set RESEND_API_KEY (and MAIL_FROM) to send replies.' }))
  } catch (e) {
    return res.send(adminInbox({
      messages: await all('select * from messages order by id desc'), counts: await counts(),
      error: 'Could not send: ' + e.message }))
  }
  await run('update messages set reply = ?, replied = ?, seen = 1 where id = ?', text, new Date().toISOString(), id)
  res.redirect('/admin/messages?sent')
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
  if (key === 'projects' || key === 'notes') {
    data.slug = slugify(data.slug || data.title) || `${key}-${Date.now()}`
    let n = 1
    while (await get(`select id from ${key} where slug = ? and id is not ?`, data.slug, req.params.id ? Number(req.params.id) : null)) {
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

app.use(async (_req, res) => {
  const { s, stats } = await context()
  res.status(404).send(notFound(s, await all(PUBLISHED), stats))
})
app.use((err, req, res, _next) => {
  console.error(err)
  const back = req.path.startsWith('/admin') ? '/admin' : '/'
  res.status(400).send(`<p style="font:16px system-ui;padding:40px">${err.message}</p><p style="font:16px system-ui;padding:0 40px"><a href="${back}">Go back</a></p>`)
})

// Listen only when run directly (node server.js, node --watch server.js). The tests
// import the app instead. Vercel must never see a listen: its launcher may run this
// file as the main module, and a listening server is proxied with the rewritten URL,
// so every path except / stops matching.
if (!process.env.VERCEL && process.argv[1] && path.resolve(process.argv[1]) === here) {
  app.listen(PORT, () => console.log(`\n  site   http://localhost:${PORT}\n  admin  http://localhost:${PORT}/admin\n`))
}

export default app
