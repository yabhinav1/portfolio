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
(() => {
  const sel = '.intro > *:not(h1), .rows .row, .split > div, .exp article, .gh > *, h2.big, .cwrap > *, .case > *'
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
    document.querySelectorAll('.row[data-cover]').forEach(row => {
      row.addEventListener('pointerenter', e => { pimg.src = row.dataset.cover; px = e.clientX; py = e.clientY; place(); peek.classList.add('on') })
      row.addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(place) })
      row.addEventListener('pointerleave', () => peek.classList.remove('on'))
    })
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

const layout = ({ s, title, body, cls = '', image = '' }) => `<!doctype html>
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
</head><body class="${cls}"><a class="skip" href="#main">Skip to content</a>${body}
<script>${SCRIPT.main}</script>
</body></html>`

const header = s => `
<header class="bar">
  <a class="brand" href="/">${esc(s.name)}<i>◗</i></a>
  <nav>
    <a href="/#work">Work</a>
    <a href="/#about">About</a>
    ${s.resume ? `<a href="${esc(s.resume)}" target="_blank" rel="noopener">Résumé</a>` : ''}
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

const workRow = (p, st) => `
<a class="row" href="/work/${esc(p.slug)}"${p.image ? ` data-cover="${esc(p.image)}"` : ''}>
  <span class="row-t">
    <b>${esc(p.title)}</b>
    ${p.summary ? `<em>${esc(fill(p.summary, st))}</em>` : ''}
    ${p.tags ? `<span class="tags">${list(p.tags).map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}
  </span>
  <span class="row-m">
    ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="132" height="82">` : '<span class="ph"></span>'}
    <span class="yr">${esc(p.year || '')}</span>
    <span class="arw" aria-hidden="true">→</span>
  </span>
</a>`

/* ---------- GitHub activity: a year of contributions as a calendar heatmap ----------
   One hue (the accent) stepping light to dark for magnitude, GitHub's own 0-4 levels,
   a title on every cell, and a plain-text summary for screen readers. */
const fmtDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const n = v => Number(v).toLocaleString('en-US')
const githubSection = (g, s) => {
  if (!g || !g.days.length) return ''
  // GitHub's grid starts on a Sunday; pad so weekdays line up in rows
  const pad = new Date(g.days[0].d + 'T00:00:00Z').getUTCDay()
  const cells = Array(pad).fill('<i class="pad"></i>').concat(g.days.map(x =>
    `<i data-l="${x.l}" title="${x.n === 0 ? 'No contributions' : `${n(x.n)} contribution${x.n === 1 ? '' : 's'}`} on ${fmtDate(x.d)}"></i>`))
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
  <div class="ghWrap">
    <div class="ghMonths" aria-hidden="true">${months.map(m => `<span style="grid-column:${m.col}">${m.m}</span>`).join('')}</div>
    <div class="ghGrid" role="img" aria-label="${esc(summary)}">${cells.join('')}</div>
  </div>
  <p class="ghFoot">
    <span class="ghLegend" aria-hidden="true">Less <i data-l="0"></i><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i> More</span>
    <a href="${esc(s.github)}" target="_blank" rel="noopener">@${esc(g.user)} on GitHub →</a>
  </p>
</section>`
}

export const homePage = ({ s, projects, experience, skills, sent, stats = {}, image = '', github = null }) => layout({
  s, image,
  body: `${header(s)}
<main id="main">

<section class="intro">
  ${s.available === '1' ? '<p class="pill"><i class="dot"></i>Open to new work</p>' : ''}
  <h1><span class="ln"><i>${esc(s.name)}</i></span><span class="ln"><i class="qi">${esc(s.role)}</i></span></h1>
  <p class="lede">${esc(s.tagline)}</p>
  <p class="meta">${s.location ? `<span>${esc(s.location)}</span>` : ''}<a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
  ${stats.raw_servers ? `<p class="live">
    <span><b data-to="${stats.raw_servers}">${esc(stats.servers)}</b> servers running Annie</span>
    <span><b data-to="${stats.raw_users}">${esc(stats.users)}</b> users reached</span>
  </p>` : ''}
  ${s.avatar ? `<img class="avatar" src="${esc(s.avatar)}" alt="${esc(s.name)}" width="76" height="76">` : ''}
</section>

<section id="work" class="block">
  <h2 class="kick"><span>Selected work</span><b>${projects.length}</b></h2>
  ${projects.length
      ? `<div class="rows">${projects.map(p => workRow(p, stats)).join('')}</div>`
      : `<p class="empty">No projects yet. Add the first one in <a href="/admin/projects/new">the admin panel</a>.</p>`}
</section>

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

export const projectPage = ({ s, p, next, stats = {} }) => layout({
  s, title: `${p.title}, ${s.name}`, cls: 'sub', image: p.image,
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
  ${p.image ? `<img class="hero" src="${esc(p.image)}" alt="${esc(p.title)}">` : ''}
  <div class="prose wide">${md(fill(p.description, stats))}</div>
  <p class="next">${next ? `<a href="/work/${esc(next.slug)}">Next: ${esc(next.title)} →</a>` : ''}
    <a href="/#contact">Building something like it? Get in touch →</a></p>
</article>
</main>${footer(s)}`,
})

export const notFound = s => layout({
  s, title: 'Not found', cls: 'sub',
  body: `${header(s)}<main id="main"><section class="intro"><h1>404<br><span class="qi">Nothing here.</span></h1>
  <p class="lede">That page moved or never existed.</p>
  <p class="meta"><a href="/">Back to the homepage</a></p></section></main>${footer(s)}`,
})
