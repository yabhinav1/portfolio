import { esc, md, list, fill, V } from '../lib.js'

const abs = (s, u) => !u ? '' : /^https?:/.test(u) ? u : `${s.site}${u}`
// Link-preview crawlers cache images by URL for a long time, so the bundled card gets a
// content hash in its URL and every change to it is picked up as a new image.
const preview = (s, u) => { const a = abs(s, u); return a.endsWith('/public/og.png') ? `${a}?v=${V.og}` : a }

// The two inline scripts, exported so the server can allow exactly these by hash in the
// Content-Security-Policy. Edit them here and the hash follows; nothing else inline runs.
export const SCRIPT = {
  // runs before first paint: reveal styles only apply when JS is on, and a theme the
  // visitor chose earlier is applied before anything renders, so there is no flash
  flag: "document.documentElement.classList.add('js');try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}",
  main: `
// Command palette (Ctrl/Cmd+K or /) and the résumé's print button. Runs on every page.
(() => {
  document.querySelector('[data-print]')?.addEventListener('click', () => print())
  const box = document.querySelector('.cmdk'), data = document.getElementById('pal')
  if (!box || !data) return
  let items = []
  try { items = JSON.parse(data.textContent) } catch (e) { return }
  const input = box.querySelector('input'), ul = box.querySelector('ul')
  let shown = [], at = 0, lastFocus = null
  const icon = { page: '↗', project: '◗', action: '⌘', link: '↗' }
  const render = () => {
    const q = input.value.trim().toLowerCase()
    shown = items.filter(i => !q || (i.t + ' ' + (i.sub || '')).toLowerCase().includes(q)).slice(0, 12)
    at = Math.min(at, Math.max(0, shown.length - 1))
    ul.innerHTML = ''
    shown.forEach((it, i) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === at))
      li.className = i === at ? 'on' : ''
      const ic = document.createElement('i'); ic.textContent = icon[it.k] || '·'
      const t = document.createElement('b'); t.textContent = it.t
      li.append(ic, t)
      if (it.sub) { const s = document.createElement('span'); s.textContent = it.sub; li.append(s) }
      const k = document.createElement('small'); k.textContent = it.k; li.append(k)
      li.addEventListener('mousemove', () => { if (at !== i) { at = i; render() } })
      li.addEventListener('click', () => run(it))
      ul.append(li)
    })
    if (!shown.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = 'Nothing matches.'; ul.append(li) }
  }
  const open = () => { lastFocus = document.activeElement; box.hidden = false; input.value = ''; at = 0; render(); requestAnimationFrame(() => input.focus()) }
  const close = () => { box.hidden = true; lastFocus?.focus?.() }
  const run = it => {
    close()
    if (it.a === 'copy') { navigator.clipboard?.writeText(it.v).then(() => toast('Email copied')); return }
    if (it.a === 'theme') { document.querySelector('.theme')?.click(); return }
    if (it.ext) window.open(it.h, '_blank', 'noopener'); else location.href = it.h
  }
  const toast = msg => {
    const t = document.createElement('div'); t.className = 'toast-mini'; t.textContent = msg
    document.body.append(t); setTimeout(() => t.remove(), 1600)
  }
  document.querySelectorAll('[data-cmdk]').forEach(b => b.addEventListener('click', open))
  addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && document.activeElement !== input
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && box.hidden)) { e.preventDefault(); box.hidden ? open() : close(); return }
    if (box.hidden) return
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % Math.max(1, shown.length); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + shown.length) % Math.max(1, shown.length); render() }
    else if (e.key === 'Enter' && shown[at]) { e.preventDefault(); run(shown[at]) }
  })
  input.addEventListener('input', () => { at = 0; render() })
  box.addEventListener('click', e => { if (e.target === box) close() })
})();

(() => {
  const sel = '.intro > *:not(h1), .rows .row, .split > div, .exp article, .gh > *, .notes > *, h2.big, .cwrap > *, .case > *'
  const els = [...document.querySelectorAll(sel)]
  if (!els.length || !('IntersectionObserver' in window)) return
  const io = new IntersectionObserver((es) => es.forEach(e => {
    if (!e.isIntersecting) return
    e.target.classList.add('in')
    io.unobserve(e.target)
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 })
  const n = new Map()
  for (const el of els) {
    const i = n.get(el.parentElement) || 0
    n.set(el.parentElement, i + 1)
    el.classList.add('reveal')
    el.style.transitionDelay = Math.min(i * 70, 350) + 'ms'
  }
  // Let the hidden state paint before observing, or elements already on screen get
  // .reveal and .in in one style recalculation and jump straight to visible.
  requestAnimationFrame(() => requestAnimationFrame(() => els.forEach(el => io.observe(el))))
  // If the observer never fires for some reason, don't leave the page blank.
  setTimeout(() => els.forEach(el => el.classList.add('in')), 3000)

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const html = document.documentElement

  // Light / dark toggle. The choice is remembered; without one the system setting applies.
  const tbtn = document.querySelector('.theme')
  if (tbtn) tbtn.addEventListener('click', () => {
    const dark = html.dataset.theme ? html.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    html.dataset.theme = dark ? 'light' : 'dark'
    try { localStorage.setItem('theme', html.dataset.theme) } catch (e) {}
  })

  // Local time in the footer, for the time zone set in the admin.
  const clock = document.querySelector('.clock')
  if (clock) {
    const tick = () => {
      try { clock.lastChild.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: clock.dataset.tz }) } catch (e) {}
    }
    tick(); setInterval(tick, 20000)
  }

  // On a pointer device, hovering a project row floats its cover in full colour next
  // to the cursor. Touch screens and small windows keep the inline thumbnail only.
  if (matchMedia('(hover: hover) and (min-width: 821px)').matches && !still) {
    const peek = document.createElement('div')
    peek.className = 'peek'
    const pimg = document.createElement('img')
    pimg.alt = ''
    peek.appendChild(pimg)
    document.body.appendChild(peek)
    let raf = 0, px = 0, py = 0
    const place = () => {
      raf = 0
      const w = peek.offsetWidth, h = peek.offsetHeight
      const x = Math.min(px + 28, innerWidth - w - 16)
      const y = Math.max(16, Math.min(py - h / 2, innerHeight - h - 16))
      peek.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    }
    // A project marked "show the live site" runs the site itself, at desktop size scaled
    // down, over its cover. Each frame starts loading when the pointer first reaches the
    // list and is kept afterwards, so hovering again is instant.
    const frames = new Map()
    const frameFor = row => {
      let f = frames.get(row)
      if (!f) {
        f = document.createElement('iframe')
        f.src = row.dataset.live
        f.tabIndex = -1
        f.setAttribute('aria-hidden', 'true')
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin')
        f.addEventListener('load', () => f.classList.add('loaded'))
        peek.appendChild(f)
        frames.set(row, f)
      }
      return f
    }
    document.querySelectorAll('.rows').forEach(rows => rows.addEventListener('pointerenter',
      () => rows.querySelectorAll('.row[data-live]').forEach(frameFor), { once: true }))
    document.querySelectorAll('.row[data-cover], .row[data-live]').forEach(row => {
      row.addEventListener('pointerenter', e => {
        const f = row.dataset.live ? frameFor(row) : null
        frames.forEach(x => x.classList.toggle('show', x === f))
        peek.classList.toggle('live', !!f)
        pimg.hidden = !row.dataset.cover
        if (row.dataset.cover) pimg.src = row.dataset.cover
        px = e.clientX; py = e.clientY; place(); peek.classList.add('on')
      })
      row.addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(place) })
      row.addEventListener('pointerleave', () => peek.classList.remove('on'))
    })
  }

  // A project page that runs its live site: desktop size scaled to fit the column, or
  // phone size on a narrow screen, so the site lays itself out the way it would there.
  // The cover shows underneath until the site has loaded.
  document.querySelectorAll('.liveframe').forEach(box => {
    const f = box.querySelector('iframe')
    const loaded = () => box.classList.add('loaded')
    f.addEventListener('load', loaded)
    setTimeout(loaded, 6000)
    // Only the width is read and only the ratio is set: setting the box's height here
    // fed back into its width through aspect-ratio, and the frame grew on every resize.
    const fit = () => {
      const w = box.clientWidth, phone = w < 600
      const vw = phone ? 390 : 1280, vh = phone ? 760 : 800
      f.style.width = vw + 'px'; f.style.height = vh + 'px'; f.style.transform = 'scale(' + w / vw + ')'
      box.style.aspectRatio = vw + '/' + vh
    }
    fit()
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(box)
  })

  // GitHub-style tooltip on the contribution calendar: instant, above the square,
  // on hover or tap. The calendar scrolls to today on narrow screens, like GitHub.
  const grid = document.querySelector('.ghGrid')
  if (grid) {
    const wrap = grid.closest('.ghWrap')
    if (wrap) wrap.scrollLeft = wrap.scrollWidth
    const tip = document.createElement('div')
    tip.className = 'ghTip'
    tip.setAttribute('role', 'tooltip')
    document.body.appendChild(tip)
    const show = cell => {
      tip.textContent = cell.dataset.tip
      tip.classList.add('on')
      const r = cell.getBoundingClientRect(), w = tip.offsetWidth
      const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))
      tip.style.left = x + 'px'
      tip.style.top = (r.top - tip.offsetHeight - 8) + 'px'
      tip.style.setProperty('--ax', (r.left + r.width / 2 - x) + 'px')
    }
    const hide = () => tip.classList.remove('on')
    grid.addEventListener('pointerover', e => { const c = e.target.closest('[data-tip]'); if (c) show(c) })
    grid.addEventListener('pointerleave', hide)
    grid.addEventListener('click', e => { const c = e.target.closest('[data-tip]'); if (c) show(c) })
    addEventListener('scroll', hide, { passive: true })
    if (wrap) wrap.addEventListener('scroll', hide, { passive: true })
  }

  const nums = [...document.querySelectorAll('b[data-to]')]
  if (!nums.length) return
  const fmt = n => n.toLocaleString('en-US')
  const count = (el) => {
    const to = Number(el.dataset.to)
    if (!to || still) return
    const dur = 1100, t0 = performance.now()
    const step = (t) => {
      const k = Math.min((t - t0) / dur, 1)
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  const io2 = new IntersectionObserver((es) => es.forEach(e => {
    if (!e.isIntersecting) return
    count(e.target)
    io2.unobserve(e.target)
  }), { threshold: 0.4 })
  nums.forEach(el => io2.observe(el))
})()
`,
}

// The command palette's entries, as a JSON data block the page script reads.
// A JSON block is never executed, so it does not need a CSP hash.
const palette = (s, projects = []) => JSON.stringify([
  { t: 'Home', h: '/', k: 'page' },
  { t: 'Work', h: '/#work', k: 'page' },
  { t: 'About', h: '/#about', k: 'page' },
  ...(s.has_notes ? [{ t: 'Notes', h: '/notes', k: 'page' }] : []),
  { t: 'Résumé', h: s.resume || '/resume', k: 'page' },
  { t: 'Get in touch', h: '/#contact', k: 'page' },
  ...projects.map(p => ({ t: p.title, sub: fill(p.summary || '', s).slice(0, 80), h: `/work/${p.slug}`, k: 'project' })),
  { t: 'Copy email address', a: 'copy', v: s.email, k: 'action' },
  { t: 'Switch light / dark', a: 'theme', k: 'action' },
  ...[['GitHub', s.github], ['LinkedIn', s.linkedin]].filter(([, u]) => u).map(([t, u]) => ({ t, h: u, k: 'link', ext: 1 })),
]).replace(/</g, '\\u003c')

const layout = ({ s, title, body, cls = '', image = '', projects = [] }) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || s.seo_title || `${s.name}, ${s.role}`)}</title>
<meta name="description" content="${esc(s.seo_description || s.tagline)}">
<meta property="og:title" content="${esc(title || s.name)}">
<meta property="og:description" content="${esc(s.seo_description || s.tagline)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(s.name)}">
${abs(s, image || s.og_image || s.avatar) ? `<meta property="og:image" content="${esc(preview(s, image || s.og_image || s.avatar))}">${preview(s, image || s.og_image || s.avatar).includes('/public/og.png') ? '\n<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ''}
<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>◗</text></svg>">
<link rel="preload" href="/public/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/public/site.css?v=${V.site}">
<meta name="view-transition" content="same-origin">
<script>${SCRIPT.flag}</script>
<style>:root{--accent:${esc(s.accent || '#b0451f')}}</style>
</head><body class="${cls}"><!--email_off--><a class="skip" href="#main">Skip to content</a>${body}
<div class="cmdk" hidden role="dialog" aria-modal="true" aria-label="Jump to">
  <div class="cmdk-box"><input type="text" placeholder="Jump to a project, page or action…" aria-label="Search" autocomplete="off" spellcheck="false">
  <ul role="listbox"></ul><p class="cmdk-foot"><span>↑↓ to move · ↵ to open · esc to close</span></p></div></div>
<script type="application/json" id="pal">${palette(s, projects)}</script>
<script>${SCRIPT.main}</script>
<!--/email_off--></body></html>`

const header = s => `
<header class="bar">
  <a class="brand" href="/">${esc(s.name)}<i>◗</i></a>
  <nav>
    <a href="/#work">Work</a>
    <a href="/#about">About</a>
    ${s.has_notes ? '<a href="/notes">Notes</a>' : ''}
    ${s.resume ? `<a href="${esc(s.resume)}" target="_blank" rel="noopener">Résumé</a>` : '<a href="/resume">Résumé</a>'}
    <button class="kbd" type="button" data-cmdk aria-label="Open the command palette" title="Jump to (Ctrl K)">⌘K</button>
    <button class="theme" type="button" aria-label="Switch between light and dark" title="Light / dark"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg></button>
    <a class="ghost" href="/#contact">Get in touch</a>
  </nav>
</header>`

// Local time for the configured zone, rendered on the server so it is right before JS runs.
const localTime = tz => { try {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
} catch { return '' } }

const footer = s => {
  const links = [['GitHub', s.github], ['LinkedIn', s.linkedin], ['Twitter', s.twitter], ['Source', s.source]].filter(([, u]) => u)
  const time = s.timezone ? localTime(s.timezone) : ''
  return `<footer class="foot">
  <span>© ${new Date().getFullYear()} ${esc(s.name)}${time ? ` <span class="clock" data-tz="${esc(s.timezone)}">· ${esc(s.location || s.timezone)} <b>${esc(time)}</b></span>` : ''}</span>
  <span class="fl">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}
  <a href="mailto:${esc(s.email)}">Email</a></span>
</footer>`
}

// "● up · 120 ms" next to a project title, from the cached status check.
const livePill = st => !st ? '' : st.up
  // A website's response time is mostly serverless cold start, so only the bot's gateway ping is shown.
  ? `<span class="live-pill up" title="Answered a check in the last 10 minutes">${st.ms != null && st.label ? `live · ${n(st.ms)} ms ${esc(st.label)}` : 'live'}</span>`
  : '<span class="live-pill down" title="Did not answer the last check">down</span>'

const timeAgo = iso => {
  const m = Math.round((Date.now() - new Date(iso)) / 60e3)
  return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`
}

// The site to embed in place of the cover, when the admin turned that on. https only,
// since the page itself is served over https and the policy allows only https frames.
const embedUrl = p => Number(p.embed) && /^https:\/\//i.test(p.link || '') ? p.link : ''

const workRow = (p, st, live) => `
<a class="row" href="/work/${esc(p.slug)}"${p.image ? ` data-cover="${esc(p.image)}"` : ''}${embedUrl(p) ? ` data-live="${esc(embedUrl(p))}"` : ''}>
  <span class="row-t">
    <b>${esc(p.title)}${livePill(live?.[p.slug])}</b>
    ${p.summary ? `<em>${esc(fill(p.summary, st))}</em>` : ''}
    ${p.tags ? `<span class="tags">${list(p.tags).map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}
  </span>
  <span class="row-m">
    ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="180" height="112">` : '<span class="ph"></span>'}
    <span class="yr">${esc(p.year || '')}</span>
    <span class="arw" aria-hidden="true">→</span>
  </span>
</a>`

/* ---------- GitHub activity: the contribution calendar, the way GitHub draws it ----------
   GitHub's five green levels, Mon/Wed/Fri down the side, months across the top, and
   GitHub's own tooltip wording ("9 contributions on August 20th."), shown by the page
   script on hover or tap. A plain-text summary covers screen readers. */
const n = v => Number(v).toLocaleString('en-US')
const ordinal = d => d + (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th')
const tipDate = d => { const x = new Date(d + 'T00:00:00Z'); return `${x.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${ordinal(x.getUTCDate())}` }
const githubSection = (g, s) => {
  if (!g || !g.days.length) return ''
  // GitHub's grid starts on a Sunday; pad so weekdays line up in rows
  const pad = new Date(g.days[0].d + 'T00:00:00Z').getUTCDay()
  const cells = Array(pad).fill('<i class="pad"></i>').concat(g.days.map(x =>
    `<i data-l="${x.l}" data-tip="${x.n === 0 ? 'No contributions' : `${n(x.n)} contribution${x.n === 1 ? '' : 's'}`} on ${tipDate(x.d)}."></i>`))
  const months = []
  g.days.forEach((x, i) => {
    if (x.d.slice(8) !== '01') return
    const col = Math.floor((i + pad) / 7) + 1
    if (months.length && col - months.at(-1).col < 3) months.pop()   // two labels in one spot: keep the later one
    months.push({ col, m: new Date(x.d + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) })
  })
  const summary = `${n(g.total)} contributions on GitHub in the last year. Current streak ${g.current} day${g.current === 1 ? '' : 's'}, longest ${g.longest}.`
  return `
<section class="block gh">
  <h2 class="kick"><span>GitHub activity</span><b>${n(g.total)}</b></h2>
  <p class="ghStats">
    <span><b>${n(g.total)}</b> contributions in the last year</span>
    <span><b>${g.current}</b> day${g.current === 1 ? '' : 's'} current streak</span>
    <span><b>${g.longest}</b> day${g.longest === 1 ? '' : 's'} longest streak</span>
  </p>
  <div class="ghWrap"><div class="ghCal">
    <span></span>
    <div class="ghMonths" aria-hidden="true">${months.map(m => `<span style="grid-column:${m.col}">${m.m}</span>`).join('')}</div>
    <div class="ghDays" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
    <div class="ghGrid" role="img" aria-label="${esc(summary)}">${cells.join('')}</div>
  </div></div>
  <p class="ghFoot">
    <span class="ghLegend" aria-hidden="true">Less <i data-l="0"></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i> More</span>
    <a href="${esc(s.github)}" target="_blank" rel="noopener">@${esc(g.user)} on GitHub →</a>
  </p>
</section>`
}

export const homePage = ({ s, projects, experience, skills, sent, stats = {}, image = '', github = null, live = {}, shipped = null, notes = [] }) => layout({
  s, image, projects,
  body: `${header(s)}
<main id="main">

<section class="intro">
  ${s.available === '1' ? '<p class="pill"><i class="dot"></i>Open to new work</p>' : ''}
  <h1><span class="ln"><i>${esc(s.name)}</i></span><span class="ln"><i class="qi">${esc(s.role)}</i></span></h1>
  <p class="lede">${esc(s.tagline)}</p>
  <p class="meta">${s.location ? `<span>${esc(s.location)}</span>` : ''}<a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
  ${(s.now || '').trim() ? `<p class="now"><b>Now</b><span>${esc(s.now)}</span></p>` : ''}
  ${shipped ? `<p class="shipped"><span class="sdot"></span>Last shipped <a href="${esc(shipped.url || '#')}" target="_blank" rel="noopener">${esc(shipped.msg)}</a> to <b>${esc(shipped.repo)}</b> · ${esc(timeAgo(shipped.at))}</p>` : ''}
  ${stats.raw_servers ? `<p class="live">
    <span><b data-to="${stats.raw_servers}">${esc(stats.servers)}</b> servers running Annie</span>
    <span><b data-to="${stats.raw_users}">${esc(stats.users)}</b> users reached</span>
  </p>` : ''}
  ${s.avatar ? `<img class="avatar" src="${esc(s.avatar)}" alt="${esc(s.name)}" width="76" height="76">` : ''}
</section>

<section id="work" class="block">
  <h2 class="kick"><span>Selected work</span><b>${projects.length}</b></h2>
  ${projects.length
      ? `<div class="rows">${projects.map(p => workRow(p, stats, live)).join('')}</div>`
      : `<p class="empty">No projects yet. Add the first one in <a href="/admin/projects/new">the admin panel</a>.</p>`}
</section>
${notes.length ? `<section class="block">
  <h2 class="kick"><span>Notes</span><b>${notes.length}</b></h2>
  <div class="notes">${notes.slice(0, 3).map(noteRow).join('')}</div>
  ${notes.length > 3 ? '<p class="more"><a href="/notes">All notes →</a></p>' : ''}
</section>` : ''}

${(s.about || '').trim() || skills.length ? `<section id="about" class="block split">
  <div>
    ${(s.about || '').trim() ? `<h2 class="kick"><span>About</span></h2>
    <div class="prose">${md(s.about)}</div>` : ''}
  </div>
  <div>
    ${skills.length ? `<h2 class="kick"><span>Toolkit</span></h2>
    <dl class="skills">${skills.map(g => `
      <div><dt>${esc(g.label)}</dt><dd>${list(g.items).map(i => `<span>${esc(i)}</span>`).join('')}</dd></div>`).join('')}
    </dl>` : ''}
  </div>
</section>` : ''}

${experience.length ? `<section class="block">
  <h2 class="kick"><span>Experience</span></h2>
  <div class="exp">${experience.map(e => `
    <article>
      <p class="per">${esc(e.period)}</p>
      <div>
        <h3>${esc(e.role)}${e.company ? ` <span>· ${esc(e.company)}</span>` : ''}</h3>
        ${e.location ? `<p class="loc">${esc(e.location)}</p>` : ''}
        ${e.description ? `<div class="prose sm">${md(fill(e.description, stats))}</div>` : ''}
      </div>
    </article>`).join('')}</div>
</section>` : ''}
${githubSection(github, s)}
<section id="contact" class="block contact">
  <h2 class="big">Let's build<br><span class="qi">something.</span></h2>
  <div class="cwrap">
    <p class="lede">Have a project, a role, or a hard problem worth talking about? Write me a line.</p>
    ${sent ? '<p class="ok" role="status">Received. I\'ll be in touch.</p>' : ''}
    <form method="post" action="/contact" class="cform">
      <label>Name<input name="name" autocomplete="name" maxlength="120"></label>
      <label>Email<input name="email" type="email" required autocomplete="email" maxlength="200"></label>
      <label class="full">Message<textarea name="body" rows="5" required maxlength="5000" placeholder="What are you building, and what's in the way?"></textarea></label>
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp">
      <button type="submit">Send message</button>
      <p class="or">or email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
    </form>
  </div>
</section>

</main>${footer(s)}`,
})

export const projectPage = ({ s, p, next, stats = {}, all = [] }) => layout({
  s, title: `${p.title}, ${s.name}`, cls: 'sub', image: p.image, projects: all,
  body: `${header(s)}
<main id="main">
<article class="case">
  <a class="back" href="/#work">← All work</a>
  <p class="kick"><span>${esc(p.year || 'Project')}</span></p>
  <h1>${esc(p.title)}</h1>
  ${p.summary ? `<p class="lede">${esc(fill(p.summary, stats))}</p>` : ''}
  <div class="caseMeta">
    ${p.tags ? `<div><dt>Built with</dt><dd>${list(p.tags).map(t => `<i>${esc(t)}</i>`).join('')}</dd></div>` : ''}
    ${p.link ? `<div><dt>Live</dt><dd><a href="${esc(p.link)}" target="_blank" rel="noopener">Visit site →</a></dd></div>` : ''}
    ${p.repo ? `<div><dt>Code</dt><dd><a href="${esc(p.repo)}" target="_blank" rel="noopener">Repository →</a></dd></div>` : ''}
  </div>
  ${embedUrl(p) ? `<figure class="livebox">
    <figcaption><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><a href="${esc(embedUrl(p))}" target="_blank" rel="noopener">${esc(embedUrl(p).replace(/^https:\/\/(www\.)?/i, '').replace(/\/$/, ''))} ↗</a></figcaption>
    <div class="liveframe"${p.image ? ` style="background-image:url('${esc(p.image)}')"` : ''}>
      <iframe src="${esc(embedUrl(p))}" title="${esc(p.title)}, live" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
    </div>
  </figure>` : p.image ? `<img class="hero" src="${esc(p.image)}" alt="${esc(p.title)}">` : ''}
  <div class="prose wide">${md(fill(p.description, stats))}</div>
  <p class="next">${next ? `<a href="/work/${esc(next.slug)}">Next: ${esc(next.title)} →</a>` : ''}
    <a href="/#contact">Building something like it? Get in touch →</a></p>
</article>
</main>${footer(s)}`,
})

/* ---------- Notes: the LinkedIn posts, on this domain ---------- */
const fmtLong = d => d ? new Date(d.length === 10 ? d + 'T00:00:00Z' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
// First lines of the body, without markdown, skipping a first line that just repeats the title.
const excerpt = (body, title = '') => {
  let t = String(body || '').replace(/\]\([^)]*\)/g, ']').replace(/[#*`>[\]!_]/g, '').split('\n').map(l => l.trim()).filter(Boolean)
  const head = String(title).toLowerCase().slice(0, 30)
  if (t[0] && head && t[0].toLowerCase().startsWith(head)) t = t.slice(1)
  const x = t.join(' ')
  return x.length > 170 ? x.slice(0, 170).replace(/\s+\S*$/, '') + '…' : x
}
const noteRow = nt => `
<a class="note-row" href="/notes/${esc(nt.slug)}">
  <span class="nd">${esc(fmtLong(nt.published_at))}</span>
  <span class="nt"><b>${esc(nt.title)}</b>${excerpt(nt.body, nt.title) ? `<em>${esc(excerpt(nt.body, nt.title))}</em>` : ''}</span>
  <span class="arw" aria-hidden="true">→</span>
</a>`

export const notesPage = ({ s, notes, projects = [] }) => layout({
  s, title: `Notes, ${s.name}`, cls: 'sub', projects,
  body: `${header(s)}<main id="main">
<section class="intro">
  <h1><span class="ln"><i>Notes</i></span><span class="ln"><i class="qi">from the work.</i></span></h1>
  <p class="lede">Short write-ups of what broke, what fixed it, and what I would do differently. Most also went out on LinkedIn.</p>
</section>
<section class="block">
  <h2 class="kick"><span>All notes</span><b>${notes.length}</b></h2>
  ${notes.length ? `<div class="notes">${notes.map(noteRow).join('')}</div>` : '<p class="empty">Nothing here yet.</p>'}
</section></main>${footer(s)}`,
})

export const notePage = ({ s, note, next, prev, projects = [] }) => layout({
  s, title: `${note.title}, ${s.name}`, cls: 'sub', image: note.image, projects,
  body: `${header(s)}<main id="main">
<article class="case note">
  <a class="back" href="/notes">← All notes</a>
  <p class="kick"><span>${esc(fmtLong(note.published_at))}</span></p>
  <h1>${esc(note.title)}</h1>
  ${note.image ? `<img class="hero" src="${esc(note.image)}" alt="">` : ''}
  <div class="prose wide">${md(note.body.split('\n').slice(note.body.startsWith(note.title) ? 1 : 0).join('\n'))}</div>
  <p class="next">${note.linkedin_url ? `<a href="${esc(note.linkedin_url)}" target="_blank" rel="noopener">Discuss on LinkedIn →</a>` : ''}
    ${prev ? `<a href="/notes/${esc(prev.slug)}">Newer: ${esc(prev.title)} →</a>` : ''}
    ${next ? `<a href="/notes/${esc(next.slug)}">Older: ${esc(next.title)} →</a>` : ''}</p>
</article></main>${footer(s)}`,
})

/* ---------- Résumé: one printable page, built from the site's own content ---------- */
export const resumePage = ({ s, stats = {}, projects, experience, skills }) => {
  const host = s.site.replace(/^https?:\/\//, '')
  const links = [[host, s.site], ['github', s.github], ['linkedin', s.linkedin]].filter(([, u]) => u)
    .map(([l, u]) => `<a href="${esc(u)}">${esc(l === host ? host : u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`)
  const summary = fill((s.headline || '').trim() || s.tagline, stats)
  const edu = String(s.education || '').split('\n').map(l => l.trim()).filter(Boolean)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.name)}, résumé</title><meta name="description" content="${esc(summary)}">
<link rel="preload" href="/public/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/public/site.css?v=${V.site}">
<script>${SCRIPT.flag}</script></head><body class="cv-body"><!--email_off-->
<div class="cv-bar"><a href="/">← ${esc(s.name)}</a><span><a href="/public/resume.pdf" download>Download PDF</a><button type="button" data-print>Print</button></span></div>
<main class="cv">
  <header class="cv-head"><h1>${esc(s.name)}</h1><p class="cv-role">${esc(s.role)}${s.location ? ` · ${esc(s.location)}` : ''}</p>
    <p class="cv-links"><a href="mailto:${esc(s.email)}">${esc(s.email)}</a>${links.join('')}</p></header>
  <p class="cv-sum">${esc(summary)}</p>
  ${experience.length ? `<section><h2>Experience</h2>${experience.map(e => `<div class="cv-item">
    <div class="cv-line"><b>${esc(e.role)}${e.company ? `, ${esc(e.company)}` : ''}</b><span>${esc(e.period || '')}</span></div>
    ${e.description ? `<div class="cv-text">${md(fill(e.description, stats))}</div>` : ''}</div>`).join('')}</section>` : ''}
  ${projects.length ? `<section><h2>Projects</h2>${projects.map(p => `<div class="cv-item">
    <div class="cv-line"><b>${esc(p.title)}</b><span>${esc(p.year || '')}</span></div>
    <div class="cv-text">${esc(fill(p.summary || '', stats))}${p.tags ? `<span class="cv-tags">${list(p.tags).map(esc).join(' · ')}</span>` : ''}</div>
    ${p.link || p.repo ? `<div class="cv-sub">${[p.link, p.repo].filter(Boolean).map(u => `<a href="${esc(u)}">${esc(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`).join(' · ')}</div>` : ''}</div>`).join('')}</section>` : ''}
  ${skills.length ? `<section><h2>Skills</h2>${skills.map(g => `<div class="cv-skill"><b>${esc(g.label)}</b><span>${list(g.items).map(esc).join(', ')}</span></div>`).join('')}</section>` : ''}
  ${edu.length ? `<section><h2>Education</h2>${edu.map(l => `<div class="cv-item"><div class="cv-line"><b>${esc(l)}</b></div></div>`).join('')}</section>` : ''}
</main><script>${SCRIPT.main}</script><!--/email_off--></body></html>`
}

// A dead end that offers the work instead: the project list doubles as the menu.
export const notFound = (s, projects = [], stats = {}) => layout({
  s, title: 'Not found', cls: 'sub',
  body: `${header(s)}<main id="main"><section class="intro"><h1>404<br><span class="qi">Nothing here.</span></h1>
  <p class="lede">That page moved or never existed. The work is still here, though.</p>
  <p class="meta"><a href="/">Back to the homepage</a><a href="/#contact">Get in touch</a></p></section>
  ${projects.length ? `<section class="block">
  <h2 class="kick"><span>Try one of these</span><b>${projects.length}</b></h2>
  <div class="rows">${projects.map(p => workRow(p, stats)).join('')}</div>
</section>` : ''}</main>${footer(s)}`,
})
