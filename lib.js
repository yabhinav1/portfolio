import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Stylesheets are served immutable, so the URL must change when the file does.
// Vercel normalises mtimes, which makes the default ETag unreliable.
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const hash = f => { try {
  return crypto.createHash('sha1').update(fs.readFileSync(path.join(pub, f))).digest('hex').slice(0, 8)
} catch { return '0' } }
export const V = { site: hash('site.css'), admin: hash('admin.css') }

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* ---------- markdown ----------
   Paragraphs, ## and ### headings, - and 1. lists, ```fenced code```, ![alt](src) on a
   line of its own, and inline **bold**, *italic*, `code`, [text](url). The whole input is
   escaped before any rule runs, so content can never inject HTML. Single newline = <br>. */

const inline = s => s.split(/(`[^`\n]+`)/).map((seg, i) => i % 2
  ? `<code>${seg.slice(1, -1)}</code>`
  : seg
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, t, u) =>
      `<a href="${u}"${u.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${t}</a>`)
).join('')

// Group lines into blocks: a fenced code block is one block whatever it contains,
// anything else is split on blank lines.
const blocks = text => {
  const out = []
  let cur = [], fence = null
  const flush = () => { if (cur.length) out.push(cur); cur = [] }
  for (const line of text.split('\n')) {
    if (fence) { cur.push(line); if (line.trim() === fence) { flush(); fence = null }; continue }
    const f = line.match(/^(`{3,})/)
    if (f) { flush(); fence = f[1]; cur.push(line); continue }
    if (!line.trim()) flush()
    else cur.push(line)
  }
  flush()
  return out
}

const IMG = /^!\[(.*?)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)$/

export const md = s => blocks(esc(s)).map(lines => {
  const first = lines[0]
  if (/^`{3,}/.test(first)) {
    const closed = lines.length > 1 && /^`{3,}$/.test(lines.at(-1).trim())
    return `<pre><code>${lines.slice(1, closed ? -1 : undefined).join('\n')}</code></pre>`
  }
  const h = lines.length === 1 && first.match(/^(#{2,3})\s+(.+)/)
  if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`
  if (lines.every(l => /^[-*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
  if (lines.every(l => /^\d+[.)]\s+/.test(l))) return `<ol>${lines.map(l => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`
  const img = lines.length === 1 && first.match(IMG)
  if (img) return `<figure><img src="${img[2]}" alt="${img[1]}" loading="lazy">${img[1] ? `<figcaption>${inline(img[1])}</figcaption>` : ''}</figure>`
  return `<p>${inline(lines.join('<br>'))}</p>`
}).join('')

export const slugify = s => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// {{servers}} style placeholders, filled at render
export const fill = (text, vars) => String(text ?? '').replace(/\{\{(\w+)\}\}/g,
  (m, k) => (k in vars ? vars[k] : m))

export const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)

// shared with push-content.js
export const SCHEMA = `
  create table if not exists settings (key text primary key, value text not null default '');
  create table if not exists projects (
    id integer primary key, title text not null default '', slug text unique,
    summary text default '', description text default '', image text default '',
    tags text default '', link text default '', repo text default '', year text default '',
    featured integer default 0, published integer default 1, position integer default 0);
  create table if not exists experience (
    id integer primary key, role text default '', company text default '', period text default '',
    location text default '', description text default '', position integer default 0);
  create table if not exists skills (
    id integer primary key, label text default '', items text default '', position integer default 0);
  create table if not exists messages (
    id integer primary key, name text default '', email text default '', body text default '',
    created text default '', seen integer default 0,
    reply text default '', replied text default '');
  create table if not exists hits (key text primary key, times text not null default '', last integer default 0);
`
