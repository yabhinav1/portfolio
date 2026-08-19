import { esc } from '../lib.js'

const shell = ({ title, nav = '', body, counts }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Admin</title><meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>⚙</text></svg>">
<link rel="stylesheet" href="/public/admin.css">
</head><body>
<aside class="side">
  <a class="logo" href="/admin/projects">Portfolio<span>admin</span></a>
  <nav>
    ${[['projects', 'Projects', counts.projects], ['experience', 'Experience', counts.experience], ['skills', 'Skills', counts.skills]]
    .map(([k, l, c]) => `<a href="/admin/${k}" class="${nav === k ? 'on' : ''}">${l}<b>${c}</b></a>`).join('')}
    <a href="/admin/messages" class="${nav === 'messages' ? 'on' : ''}">Inbox${counts.unread ? `<b class="new">${counts.unread}</b>` : `<b>0</b>`}</a>
    <a href="/admin/settings" class="${nav === 'settings' ? 'on' : ''}">Settings</a>
  </nav>
  <div class="sideFoot">
    <a href="/" target="_blank" class="view">View site ↗</a>
    <form method="post" action="/admin/logout"><button>Sign out</button></form>
  </div>
</aside>
<main class="main">${body}</main>
</body></html>`

const head = (title, sub, action = '') => `
<header class="head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${action}</header>`

/* ---------- field rendering ---------- */
const field = (f, row) => {
  const v = row[f.n] ?? f.def ?? ''
  const hint = f.hint ? `<small>${esc(f.hint)}</small>` : ''
  const id = `f_${f.n}`
  if (f.t === 'bool') return `
    <div class="fld check">
      <label><input type="checkbox" name="${f.n}" id="${id}" ${Number(v) ? 'checked' : ''}><span>${esc(f.l)}</span></label>
      ${hint}
    </div>`
  if (f.t === 'textarea') return `
    <div class="fld wide">
      <label for="${id}">${esc(f.l)}</label>
      <textarea name="${f.n}" id="${id}" rows="${f.rows || 5}">${esc(v)}</textarea>${hint}
    </div>`
  if (f.t === 'image') return `
    <div class="fld wide img" data-img>
      <label for="${id}">${esc(f.l)}</label>
      <div class="imgRow">
        <img class="prev" src="${esc(v) || 'data:,'}" alt="" ${v ? '' : 'hidden'}>
        <div class="imgCtl">
          <input type="text" name="${f.n}" id="${id}" value="${esc(v)}" placeholder="/uploads/…  or  https://…">
          <label class="up">Upload image<input type="file" accept="image/*" hidden></label>
          <small class="st">PNG, JPG, WebP, SVG · up to 8&nbsp;MB</small>
        </div>
      </div>
    </div>`
  return `
    <div class="fld">
      <label for="${id}">${esc(f.l)}${f.req ? ' <i>*</i>' : ''}</label>
      <input type="${f.t === 'number' ? 'number' : 'text'}" name="${f.n}" id="${id}"
        value="${esc(v)}" ${f.req ? 'required' : ''} ${f.t === 'number' ? 'step="1"' : ''}>${hint}
    </div>`
}

const uploadJS = `<script>
document.querySelectorAll('[data-img]').forEach(box => {
  const file = box.querySelector('input[type=file]')
  const text = box.querySelector('input[type=text]')
  const prev = box.querySelector('.prev')
  const st = box.querySelector('.st')
  const show = u => { if (u) { prev.src = u; prev.hidden = false } else prev.hidden = true }
  text.addEventListener('input', () => show(text.value))
  file.addEventListener('change', async () => {
    if (!file.files[0]) return
    st.textContent = 'Uploading…'
    const fd = new FormData(); fd.append('file', file.files[0])
    try {
      const r = await fetch('/admin/upload', { method: 'POST', body: fd })
      const { url } = await r.json()
      if (!url) throw new Error('rejected')
      text.value = url; show(url); st.textContent = 'Uploaded ✓'
    } catch { st.textContent = 'Upload failed — images only, max 8 MB.' }
  })
})
</script>`

/* ---------- pages ---------- */
export const adminList = ({ key, spec, rows, counts }) => shell({
  title: spec.label, nav: key, counts,
  body: `${head(spec.label, `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · lowest sort order shows first`,
    `<a class="btn primary" href="/admin/${key}/new">New ${spec.singular.toLowerCase()}</a>`)}
${rows.length ? `
<table class="tbl">
  <thead><tr>${spec.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th class="r">Order</th><th></th></tr></thead>
  <tbody>${rows.map(r => `
    <tr>
      ${spec.cols.map(([c]) => `<td>${c === 'published'
      ? `<span class="chip ${Number(r[c]) ? 'live' : ''}">${Number(r[c]) ? 'Live' : 'Draft'}</span>`
      : `<a class="cell" href="/admin/${key}/${r.id}">${esc(String(r[c] ?? '').slice(0, 90)) || '—'}</a>`}</td>`).join('')}
      <td class="r num">${esc(r.position)}</td>
      <td class="r acts">
        <a class="btn sm" href="/admin/${key}/${r.id}">Edit</a>
        <form method="post" action="/admin/${key}/${r.id}/delete" onsubmit="return confirm('Delete this ${spec.singular.toLowerCase()}? This cannot be undone.')">
          <button class="btn sm danger">Delete</button></form>
      </td>
    </tr>`).join('')}</tbody>
</table>` : `<div class="empty"><p>No ${spec.label.toLowerCase()} yet.</p>
  <a class="btn primary" href="/admin/${key}/new">Add the first one</a></div>`}`,
})

export const adminForm = ({ key, spec, row, counts }) => shell({
  title: row.id ? `Edit ${spec.singular}` : `New ${spec.singular}`, nav: key, counts,
  body: `${head(row.id ? `Edit ${spec.singular.toLowerCase()}` : `New ${spec.singular.toLowerCase()}`,
    row.id ? row.title || row.role || row.label : `Adding to ${spec.label.toLowerCase()}`,
    `<a class="btn" href="/admin/${key}">Cancel</a>`)}
<form method="post" action="/admin/${key}${row.id ? '/' + row.id : ''}" class="form">
  <div class="grid">${spec.fields.map(f => field(f, row)).join('')}</div>
  <div class="save">
    <button class="btn primary" type="submit">${row.id ? 'Save changes' : `Create ${spec.singular.toLowerCase()}`}</button>
    ${row.id && key === 'projects' && row.slug ? `<a class="btn" href="/work/${esc(row.slug)}" target="_blank">Preview ↗</a>` : ''}
  </div>
</form>${uploadJS}`,
})

const SETTING_GROUPS = [
  ['Identity', [
    { n: 'name', l: 'Your name', t: 'text' }, { n: 'role', l: 'Role / title', t: 'text' },
    { n: 'location', l: 'Location', t: 'text' }, { n: 'email', l: 'Contact email', t: 'text' },
    { n: 'tagline', l: 'Tagline', t: 'textarea', rows: 2, hint: 'One sentence under your name on the homepage.' },
    { n: 'about', l: 'About', t: 'textarea', rows: 7, hint: 'Blank line = new paragraph. **bold** and [text](url) work.' },
    { n: 'avatar', l: 'Photo', t: 'image' },
  ]],
  ['Links', [
    { n: 'resume', l: 'Résumé URL', t: 'text' }, { n: 'github', l: 'GitHub', t: 'text' },
    { n: 'linkedin', l: 'LinkedIn', t: 'text' }, { n: 'twitter', l: 'Twitter / X', t: 'text' },
  ]],
  ['Appearance & SEO', [
    { n: 'available', l: 'Show "available for work" badge', t: 'bool' },
    { n: 'accent', l: 'Accent colour', t: 'text', hint: 'Any CSS colour — #b0451f, #2f4fd8, teal…' },
    { n: 'seo_title', l: 'Browser tab title', t: 'text', hint: 'Blank = "Name — Role".' },
    { n: 'seo_description', l: 'Search description', t: 'textarea', rows: 2, hint: 'Blank = your tagline.' },
    { n: 'og_image', l: 'Link preview image', t: 'image' },
  ]],
]

export const adminSettings = ({ s, counts, saved }) => shell({
  title: 'Settings', nav: 'settings', counts,
  body: `${head('Settings', 'Everything on the site that isn\'t a project')}
${saved ? '<p class="toast" role="status">Saved. <a href="/" target="_blank">View the site ↗</a></p>' : ''}
<form method="post" action="/admin/settings" class="form">
  ${SETTING_GROUPS.map(([g, fields]) => `
    <section class="group"><h2>${esc(g)}</h2>
      <div class="grid">${fields.map(f => field(f, s)).join('')}</div>
    </section>`).join('')}
  <div class="save"><button class="btn primary" type="submit">Save settings</button></div>
</form>${uploadJS}`,
})

export const adminInbox = ({ messages, counts }) => shell({
  title: 'Inbox', nav: 'messages', counts,
  body: `${head('Inbox', `${messages.length} message${messages.length === 1 ? '' : 's'} from the contact form`)}
${messages.length ? `<div class="msgs">${messages.map(m => `
  <article class="msg ${m.seen ? '' : 'unread'}">
    <header>
      <div><b>${esc(m.name) || 'Anonymous'}</b>
        <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>
      <div class="mact">
        <time>${esc(new Date(m.created).toLocaleString())}</time>
        <form method="post" action="/admin/messages/${m.id}/seen"><button class="btn sm">${m.seen ? 'Mark unread' : 'Mark read'}</button></form>
        <form method="post" action="/admin/messages/${m.id}/delete" onsubmit="return confirm('Delete this message?')"><button class="btn sm danger">Delete</button></form>
      </div>
    </header>
    <p>${esc(m.body).replace(/\n/g, '<br>')}</p>
  </article>`).join('')}</div>`
      : `<div class="empty"><p>No messages yet.</p><small>Anything sent through the contact form on your site lands here.</small></div>`}`,
})

export const loginPage = ({ error }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Admin</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="/public/admin.css"></head>
<body class="loginBody">
<form method="post" action="/admin/login" class="login">
  <h1>Portfolio admin</h1>
  <p>Sign in to edit your site.</p>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  <label for="pw">Password</label>
  <input id="pw" type="password" name="password" required autofocus autocomplete="current-password">
  <button class="btn primary" type="submit">Sign in</button>
  <a class="back" href="/">← Back to site</a>
</form></body></html>`
