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

// paragraphs, bold, links, line breaks
export const md = s => esc(s).split(/\n{2,}/).filter(Boolean).map(p =>
  `<p>${p.replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')}</p>`
).join('')

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
`

