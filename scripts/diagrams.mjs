// Architecture diagrams for the case studies, written to public/diagrams/*.svg.
// Every label comes from the project's own README or case study. Run: node scripts/diagrams.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'diagrams')
fs.mkdirSync(out, { recursive: true })

const C = { bg: '#0b0b0c', dot: '#1b1b1f', box: '#131316', line: '#2e2e34', ink: '#f2f2f2', mut: '#9a9aa3',
  dim: '#62626b', edge: '#5d5d66', acc: '#7ea2ff', accFill: '#141a2b' }
const SANS = "Inter, 'Segoe UI', system-ui, sans-serif"
const MONO = "'JetBrains Mono', Consolas, 'SFMono-Regular', monospace"
const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const text = (tx, ty, s, { size = 12, fill = C.mut, font = MONO, weight = 400, anchor = 'start', ls = 0 } = {}) =>
  `<text x="${tx}" y="${ty}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ''}>${x(s)}</text>`

// A node: title plus mono lines. kind 'db' draws a cylinder, accent marks the part the case study is about.
const box = (bx, by, w, h, title, lines = [], { accent = false, kind = 'box' } = {}) => {
  const stroke = accent ? C.acc : C.line, fill = accent ? C.accFill : C.box
  const e = 9, top = kind === 'db' ? e + 4 : 0
  const shape = kind === 'db'
    ? `<path d="M${bx},${by + e} a${w / 2},${e} 0 0 1 ${w},0 V${by + h - e} a${w / 2},${e} 0 0 1 ${-w},0 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
       <path d="M${bx},${by + e} a${w / 2},${e} 0 0 0 ${w},0" fill="none" stroke="${stroke}" stroke-width="1.2"/>`
    : `<rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`
  const block = 20 + lines.length * 17
  const y0 = by + top + (h - top - block) / 2 + 15
  return shape + text(bx + 16, y0, title, { size: 15, fill: C.ink, font: SANS, weight: 600 })
    + lines.map((l, i) => text(bx + 16, y0 + 21 + i * 17, l, { fill: accent ? '#b9c9ff' : C.mut })).join('')
}

const group = (gx, gy, w, h, label) =>
  `<rect x="${gx}" y="${gy}" width="${w}" height="${h}" rx="14" fill="none" stroke="${C.line}" stroke-dasharray="5 5"/>`
  + `<rect x="${gx + 16}" y="${gy - 9}" width="${label.length * 7.2 + 14}" height="18" fill="${C.bg}"/>`
  + text(gx + 23, gy + 4, label.toUpperCase(), { size: 11, fill: C.acc, ls: 1.2 })

// An orthogonal edge through the given points. Arrow at the end, optionally at both ends.
const edge = (pts, { label, at, both = false, accent = false, dashed = false, arrow = true } = {}) => {
  const col = accent ? C.acc : C.edge, m = accent ? 'aa' : 'a'
  let s = `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="1.5"${dashed ? ' stroke-dasharray="4 4"' : ''}${arrow ? ` marker-end="url(#${m})"` : ''}${both ? ` marker-start="url(#${m})"` : ''}/>`
  if (label) {
    const [lx, ly] = at, w = label.length * 6.5 + 12
    s += `<rect x="${lx - w / 2}" y="${ly - 12}" width="${w}" height="18" rx="4" fill="${C.bg}"/>`
      + text(lx, ly + 1, label, { size: 11, fill: accent ? C.acc : '#b8b8c0', anchor: 'middle' })
  }
  return s
}

const svg = (W, H, name, body, foot = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${x(name)} architecture">
<defs>
  <pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${C.dot}"/></pattern>
  <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.edge}"/></marker>
  <marker id="aa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.acc}"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="${H}" fill="url(#g)"/>
${body}
${text(40, H - 26, `${name} · architecture`.toUpperCase(), { size: 11, fill: C.dim, ls: 1.5 })}
${foot ? text(W - 40, H - 26, foot, { size: 11, fill: C.dim, anchor: 'end' }) : ''}
</svg>
`

const D = {}

D.annie = svg(1200, 640, 'Annie', [
  box(40, 240, 200, 110, 'Discord', ['gateway events', 'OAuth2 sign-in']),
  group(280, 80, 410, 420, 'Bot · discord.js · ~125k lines'),
  box(305, 115, 360, 96, 'ShardingManager', ['MALLOC_ARENA_MAX and', 'MALLOC_MMAP_THRESHOLD_ set first'], { accent: true }),
  box(305, 240, 108, 62, 'Shard 0'), box(431, 240, 108, 62, 'Shard 1'), box(557, 240, 108, 62, 'Shard n'),
  edge([[359, 211], [359, 240]]), edge([[485, 211], [485, 240]]), edge([[611, 211], [611, 240]]),
  box(305, 332, 360, 140, 'Commands', ['313 prefix · 104 slash', '23 categories · 29 listeners', 'anti-nuke · automod', 'coin market with charts']),
  group(730, 80, 430, 420, 'Dashboard · Next.js · 128 API routes'),
  box(755, 112, 380, 62, 'Discord OAuth2 login'),
  box(755, 186, 380, 62, 'Per-guild config panels'),
  box(755, 260, 380, 62, 'Premium checkout', ['IPN payment callbacks']),
  box(755, 334, 380, 62, 'Ticket transcripts'),
  box(755, 408, 380, 72, 'Status page', ['8 services · latency · incidents']),
  edge([[240, 271], [305, 271]], { label: 'events', at: [272, 258] }),
  edge([[140, 240], [140, 50], [1110, 50], [1110, 112]], { label: 'OAuth2', at: [540, 50] }),
  box(525, 545, 310, 64, 'MongoDB', [], { kind: 'db' }),
  edge([[600, 500], [600, 545]], { both: true }),
  edge([[760, 500], [760, 545]], { both: true }),
].join('\n'), '')

D.dailyos = svg(1200, 600, 'DailyOS', [
  box(40, 225, 230, 110, 'Browser', ['guest notes stay in', 'localStorage until', 'sign-in, then migrate']),
  box(320, 245, 160, 70, 'Cloudflare'),
  group(530, 70, 340, 460, 'Vercel · Next.js 16'),
  box(555, 105, 290, 80, 'App Router', ['server actions · 11 modules']),
  box(555, 215, 290, 96, 'Auth.js v5', ['Google · GitHub ·', 'email + 6-digit code']),
  box(555, 340, 290, 76, 'Prisma 7', ['34 models, one schema'], { accent: true }),
  box(555, 440, 290, 66, 'Daily cron', ['purges accounts past deadline']),
  box(920, 100, 240, 90, 'MongoDB GridFS', ['file bytes, off the', 'rows read every page'], { kind: 'db' }),
  box(920, 218, 240, 90, 'ZeptoMail', ['codes and JSON exports', 'via nodemailer']),
  box(920, 333, 240, 90, 'Postgres · Neon', ['sslmode=verify-full'], { kind: 'db', accent: true }),
  edge([[270, 280], [320, 280]]),
  edge([[480, 280], [530, 280]]),
  edge([[845, 145], [920, 145]], { label: 'files', at: [882, 132] }),
  edge([[845, 263], [920, 263]], { label: 'mail', at: [882, 250] }),
  edge([[845, 378], [920, 378]], { accent: true }),
].join('\n'), 'Tiptap · Zustand · Tailwind v4')

D['silent-co-driver'] = svg(1200, 600, 'The Silent Co-Driver', [
  box(40, 230, 200, 100, 'Team radio clip', ['72 calls · 4 drivers', 'from a HF dataset']),
  group(290, 70, 390, 400, 'Local models · offline'),
  box(315, 105, 340, 80, 'faster-whisper large-v3', ['transcript, a timestamp per word']),
  box(315, 225, 340, 80, 'DistilRoBERTa', ['emotion from the words']),
  box(315, 365, 340, 80, 'HuBERT', ['emotion from the sound']),
  edge([[240, 280], [268, 280], [268, 145], [315, 145]]),
  edge([[268, 280], [268, 405], [315, 405]]),
  edge([[485, 185], [485, 225]], { label: 'text', at: [520, 205] }),
  box(730, 195, 230, 170, 'stress_score()', ['tone 0.65 · words 0.35', 'loud = stress', 'flat = tired', '90th pct of 63 clips'], { accent: true }),
  edge([[655, 265], [730, 265]], { label: '0.35', at: [692, 252] }),
  edge([[655, 405], [700, 405], [700, 330], [730, 330]], { label: '0.65', at: [700, 420] }),
  box(1000, 195, 160, 170, 'Lap join', ['on timestamp', '0-100 score', 'on the lap', 'chart']),
  edge([[960, 280], [1000, 280]], { accent: true }),
  box(1000, 425, 160, 90, 'laps.csv', ['278 laps', 'via fastf1'], { kind: 'db' }),
  edge([[1080, 425], [1080, 365]]),
].join('\n'), 'FastAPI · GET /api/laps · POST /api/analyse')

D.fieldmind = svg(1200, 680, 'FieldMind', [
  group(40, 70, 690, 560, 'Edge device · one process'),
  box(65, 110, 300, 76, 'Dashboard and API', ['behind a device PIN']),
  box(65, 225, 300, 112, 'Policy engine', ['about 20 ms per note', 'patterns · BERT names', 'semantic classifier'], { accent: true }),
  box(65, 380, 300, 96, 'Journal · SQLite', ['durable outbox', 'and conflicts'], { kind: 'db' }),
  group(400, 110, 305, 315, 'Qdrant Edge · ~1 ms'),
  box(418, 140, 268, 80, 'Local shard', ['written here, private sealed'], { kind: 'db', accent: true }),
  box(418, 238, 268, 80, 'Replica shard', ['copy of cloud knowledge'], { kind: 'db' }),
  box(418, 336, 268, 70, 'Photo shard', [], { kind: 'db' }),
  box(400, 465, 305, 136, 'Answer model', ['llama3.2 3B, on device', 'reranked by a 23 MB', 'cross-encoder; facts checked', 'against the cited note']),
  edge([[215, 186], [215, 225]]),
  edge([[365, 265], [390, 265], [390, 182], [418, 182]]),
  edge([[215, 337], [215, 380]]),
  edge([[552, 425], [552, 465]], { label: 'bge-small + BM25', at: [552, 445] }),
  box(880, 80, 280, 76, 'Headquarters', ['publishes manuals']),
  box(880, 200, 280, 96, 'Qdrant Server', ['fleet_memory', 'shard snapshots'], { kind: 'db' }),
  box(880, 430, 280, 76, 'Other edge devices', ['same fleet']),
  edge([[1020, 156], [1020, 200]]),
  edge([[686, 215], [880, 215]], { label: 'push · compare-and-swap', at: [790, 202], accent: true }),
  edge([[880, 280], [686, 280]], { label: 'pull · diff or snapshot', at: [790, 267] }),
  edge([[1020, 296], [1020, 430]], { both: true }),
  edge([[880, 468], [730, 468]], { label: 'same network', at: [805, 455], dashed: true, both: true }),
].join('\n'), 'Team Compilers · Qdrant Edge hackathon')

D.fieldproof = svg(1200, 620, 'FieldProof', [
  box(40, 105, 190, 84, 'Field photos', ['GPS + EXIF date']),
  box(275, 105, 230, 84, 'Cloudinary', ['upload · transforms', 'the original asset'], { accent: true }),
  box(550, 105, 280, 84, 'Organise', ['site from GPS distance', 'phase from capture date']),
  box(875, 105, 285, 84, 'Verify', ['perceptual hash · GPS', 'and date · phase order']),
  edge([[230, 147], [275, 147]]), edge([[505, 147], [550, 147]]), edge([[830, 147], [875, 147]]),
  box(430, 255, 340, 96, 'Postgres + pgvector', ['assets, metadata, vectors'], { kind: 'db' }),
  edge([[1017, 189], [1017, 222], [600, 222], [600, 255]], { label: 'doubtful photos flagged', at: [810, 222] }),
  box(875, 260, 285, 86, 'Gemini', ['captions · tags', 'before/after assessments']),
  edge([[875, 303], [770, 303]], { both: true }),
  edge([[600, 351], [600, 385], [210, 385], [210, 420]]), edge([[600, 385], [600, 420]]), edge([[600, 385], [990, 385], [990, 420]]),
  box(40, 420, 340, 112, 'Compare', ['same-location verdict first,', 'then five fixed metrics']),
  box(430, 420, 340, 112, 'Search', ['semantic + keyword, fused', 'keyword-only if AI is down']),
  box(820, 420, 340, 112, 'Report', ['narrative from recorded facts', 'every image traces back'], { accent: true }),
].join('\n'), 'Next.js 16 · TypeScript strict · Vercel')

for (const [k, v] of Object.entries(D)) fs.writeFileSync(path.join(out, `${k}.svg`), v)
console.log('wrote', Object.keys(D).map(k => `${k}.svg`).join(', '))
