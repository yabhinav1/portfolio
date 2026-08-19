export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ponytail: 4-rule markdown (paragraphs, bold, links, breaks). Swap in `marked` if posts need more.
export const md = s => esc(s).split(/\n{2,}/).filter(Boolean).map(p =>
  `<p>${p.replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')}</p>`
).join('')

export const slugify = s => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean)

// Shared so push-content.js can create the tables before copying into them.
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
    created text default '', seen integer default 0);
`

