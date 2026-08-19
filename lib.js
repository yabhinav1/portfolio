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
