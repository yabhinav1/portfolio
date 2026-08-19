import { esc, md, list } from '../lib.js'

const abs = (s, u) => !u ? '' : /^https?:/.test(u) ? u : `${s.site}${u}`

const layout = ({ s, title, body, cls = '', image = '' }) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || s.seo_title || `${s.name} — ${s.role}`)}</title>
<meta name="description" content="${esc(s.seo_description || s.tagline)}">
<meta property="og:title" content="${esc(title || s.name)}">
<meta property="og:description" content="${esc(s.seo_description || s.tagline)}">
<meta property="og:type" content="website">
${abs(s, image || s.og_image || s.avatar) ? `<meta property="og:image" content="${esc(abs(s, image || s.og_image || s.avatar))}">
<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>◗</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/site.css">
<script>document.documentElement.classList.add('js')</script>
<style>:root{--accent:${esc(s.accent || '#b0451f')}}</style>
</head><body class="${cls}"><a class="skip" href="#main">Skip to content</a>${body}
<script>
(() => {
  const sel = '.intro > *, .rows .row, .split > div, .exp article, h2.big, .cwrap > *, .case > *'
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
    el.style.transitionDelay = Math.min(i * 60, 300) + 'ms'
    io.observe(el)
  }
})()
</script>
</body></html>`

const header = s => `
<header class="bar">
  <a class="brand" href="/">${esc(s.name)}<i>◗</i></a>
  <nav>
    <a href="/#work">Work</a>
    <a href="/#about">About</a>
    ${s.resume ? `<a href="${esc(s.resume)}">Résumé</a>` : ''}
    <a class="ghost" href="/#contact">Get in touch</a>
  </nav>
</header>`

const footer = s => {
  const links = [['GitHub', s.github], ['LinkedIn', s.linkedin], ['Twitter', s.twitter], ['Source', s.source]].filter(([, u]) => u)
  return `<footer class="foot">
  <span>© ${new Date().getFullYear()} ${esc(s.name)}</span>
  <span class="fl">${links.map(([l, u]) => `<a href="${esc(u)}" rel="noopener">${l}</a>`).join('')}
  <a href="mailto:${esc(s.email)}">Email</a></span>
</footer>`
}

const workRow = p => `
<a class="row" href="/work/${esc(p.slug)}">
  <span class="row-t">
    <b>${esc(p.title)}</b>
    ${p.summary ? `<em>${esc(p.summary)}</em>` : ''}
    ${p.tags ? `<span class="tags">${list(p.tags).map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}
  </span>
  <span class="row-m">
    ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="132" height="82">` : '<span class="ph"></span>'}
    <span class="yr">${esc(p.year || '')}</span>
    <span class="arw" aria-hidden="true">→</span>
  </span>
</a>`

export const homePage = ({ s, projects, experience, skills, sent }) => layout({
  s,
  body: `${header(s)}
<main id="main">

<section class="intro">
  ${s.available === '1' ? '<p class="pill"><i class="dot"></i>Available for new work</p>' : ''}
  <h1>${esc(s.name)}<br><span class="qi">${esc(s.role)}</span></h1>
  <p class="lede">${esc(s.tagline)}</p>
  <p class="meta">${s.location ? `<span>${esc(s.location)}</span>` : ''}<a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
  ${s.avatar ? `<img class="avatar" src="${esc(s.avatar)}" alt="${esc(s.name)}" width="76" height="76">` : ''}
</section>

<section id="work" class="block">
  <h2 class="kick"><span>Selected work</span><b>${projects.length}</b></h2>
  ${projects.length
      ? `<div class="rows">${projects.map(workRow).join('')}</div>`
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
        ${e.description ? `<div class="prose sm">${md(e.description)}</div>` : ''}
      </div>
    </article>`).join('')}</div>
</section>` : ''}

<section id="contact" class="block contact">
  <h2 class="big">Let's build<br><span class="qi">something.</span></h2>
  <div class="cwrap">
    <p class="lede">Tell me what you're working on. I read every message and reply within a day or two.</p>
    ${sent ? '<p class="ok" role="status">Thanks — your message landed. I\'ll get back to you soon.</p>' : ''}
    <form method="post" action="/contact" class="cform">
      <label>Name<input name="name" autocomplete="name" maxlength="120"></label>
      <label>Email<input name="email" type="email" required autocomplete="email" maxlength="200"></label>
      <label class="full">Message<textarea name="body" rows="5" required maxlength="5000" placeholder="A sentence or two about the project, timeline, and budget range."></textarea></label>
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp">
      <button type="submit">Send message</button>
      <p class="or">or email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
    </form>
  </div>
</section>

</main>${footer(s)}`,
})

export const projectPage = ({ s, p, next }) => layout({
  s, title: `${p.title} — ${s.name}`, cls: 'sub', image: p.image,
  body: `${header(s)}
<main id="main">
<article class="case">
  <a class="back" href="/#work">← All work</a>
  <p class="kick"><span>${esc(p.year || 'Project')}</span></p>
  <h1>${esc(p.title)}</h1>
  ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ''}
  <div class="caseMeta">
    ${p.tags ? `<div><dt>Built with</dt><dd>${list(p.tags).map(t => `<i>${esc(t)}</i>`).join('')}</dd></div>` : ''}
    ${p.link ? `<div><dt>Live</dt><dd><a href="${esc(p.link)}" rel="noopener">Visit site →</a></dd></div>` : ''}
    ${p.repo ? `<div><dt>Code</dt><dd><a href="${esc(p.repo)}" rel="noopener">Repository →</a></dd></div>` : ''}
  </div>
  ${p.image ? `<img class="hero" src="${esc(p.image)}" alt="${esc(p.title)}">` : ''}
  <div class="prose wide">${md(p.description)}</div>
  <p class="next">${next ? `<a href="/work/${esc(next.slug)}">Next — ${esc(next.title)} →</a>` : ''}
    <a href="/#contact">Want something like this? Get in touch →</a></p>
</article>
</main>${footer(s)}`,
})

export const notFound = s => layout({
  s, title: 'Not found', cls: 'sub',
  body: `${header(s)}<main id="main"><section class="intro"><h1>404<br><span class="qi">Nothing here.</span></h1>
  <p class="lede">That page moved or never existed.</p>
  <p class="meta"><a href="/">Back to the homepage</a></p></section></main>${footer(s)}`,
})
