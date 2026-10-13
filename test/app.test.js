import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A throwaway data directory, so the tests never touch portfolio.db
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-test-'))
process.env.DATA_DIR = dir
process.env.ADMIN_PASSWORD = 'correct horse'
process.env.SESSION_SECRET = 'test-secret'
delete process.env.TURSO_DATABASE_URL
delete process.env.VERCEL
delete process.env.BLOB_READ_WRITE_TOKEN

const { default: app } = await import('../server.js')

let server, base
before(async () => {
  await new Promise(r => { server = app.listen(0, r) })
  base = `http://127.0.0.1:${server.address().port}`
})
// On Windows the SQLite file stays locked by the open client, so a failed cleanup is not an error.
after(() => { server.close(); try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

const get = (p, h = {}) => fetch(base + p, { redirect: 'manual', headers: h })
const post = (p, body, h = {}) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...h },
  body: new URLSearchParams(body).toString(),
})
// Log in once and reuse the cookie, so the login limiter test below is the only one
// that spends attempts.
let sid
const login = async () => {
  if (sid) return sid
  const r = await post('/admin/login', { password: 'correct horse' })
  assert.equal(r.status, 302)
  const cookie = r.headers.get('set-cookie')
  assert.match(cookie, /^sid=/)
  assert.match(cookie, /HttpOnly/)
  return (sid = cookie.split(';')[0])
}

test('homepage renders the seed content with security headers', async () => {
  const r = await get('/')
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.match(html, /Selected work/)
  assert.match(html, /Nimbus Analytics/)
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.equal(r.headers.get('x-powered-by'), null)
  const csp = r.headers.get('content-security-policy')
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /script-src 'sha256-[^']+' 'sha256-[^']+';/, 'public pages allow only the two hashed scripts')
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp))
  assert.ok(!html.includes('fonts.googleapis.com'), 'fonts are self-hosted')
})

test('inline script hashes match what the page actually ships', async () => {
  const r = await get('/')
  const html = await r.text()
  const csp = r.headers.get('content-security-policy')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  assert.equal(scripts.length, 2)
  for (const js of scripts) {
    const h = createHash('sha256').update(js).digest('base64')
    assert.ok(csp.includes(`'sha256-${h}'`), 'every inline script is allowed by the policy')
  }
})

test('project page, 404, sitemap and robots', async () => {
  const ok = await get('/work/nimbus-analytics')
  assert.equal(ok.status, 200)
  assert.match(await ok.text(), /Nimbus Analytics/)
  assert.equal((await get('/work/nope')).status, 404)
  assert.equal((await get('/no-such-page')).status, 404)
  assert.match(await (await get('/sitemap.xml')).text(), /\/work\/nimbus-analytics/)
  assert.match(await (await get('/robots.txt')).text(), /Disallow: \/admin/)
})

test('admin requires login and rejects a forged cookie', async () => {
  const r = await get('/admin/projects')
  assert.equal(r.status, 302)
  assert.equal(r.headers.get('location'), '/admin/login')
  assert.equal((await get('/admin/projects', { cookie: 'sid=admin.forged' })).status, 302)
  assert.equal((await post('/admin/login', { password: 'nope' })).status, 401)
})

test('admin pages render for a signed-in user', async () => {
  const cookie = await login()
  const inside = await get('/admin/projects', { cookie })
  assert.equal(inside.status, 200)
  assert.match(await inside.text(), /Nimbus Analytics/)
  assert.match(inside.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/, 'admin keeps its inline handlers')
  assert.equal((await get('/admin/settings', { cookie })).status, 200)
  assert.equal((await get('/admin/messages', { cookie })).status, 200)
})

test('admin creates a project and its markdown renders on the public page', async () => {
  const cookie = await login()
  const create = await post('/admin/projects', {
    title: 'Test Project', summary: 'A summary', year: '2026', published: 'on', image: '/public/cover.png',
    description: '## Why\n\n- fast\n- small\n\nUses `node:sqlite`.\n\n![Shot](/public/x.png)',
  }, { cookie })
  assert.equal(create.status, 302)
  const page = await (await get('/work/test-project')).text()
  assert.match(page, /<h2>Why<\/h2>/)
  assert.match(page, /<ul><li>fast<\/li><li>small<\/li><\/ul>/)
  assert.match(page, /<code>node:sqlite<\/code>/)
  assert.match(page, /<figure><img src="\/public\/x.png"/)
  assert.match(page, /og:image" content="http:\/\/localhost:\d+\/public\/cover.png"/)
  // with no preview image configured, the first project cover becomes the homepage preview
  assert.match(await (await get('/')).text(), /og:image" content="http:\/\/localhost:\d+\/public\/cover.png"/)
})

test('contact form validates, stores, and rate-limits by address', async () => {
  assert.equal((await post('/contact', { email: 'not-an-email', body: 'hi' })).status, 400)
  const hp = await post('/contact', { email: 'a@b.co', body: 'spam', website: 'http://spam' })
  assert.equal(hp.status, 302, 'honeypot pretends to succeed')
  for (let i = 0; i < 3; i++) {
    const r = await post('/contact', { name: 'T', email: 'a@b.co', body: `message ${i}` })
    assert.equal(r.status, 302)
    assert.equal(r.headers.get('location'), '/?sent#contact')
  }
  // bad + honeypot + 3 = 5 hits in the hour window
  assert.equal((await post('/contact', { email: 'a@b.co', body: 'one more' })).status, 429)
  const inbox = await (await get('/admin/messages', { cookie: await login() })).text()
  assert.match(inbox, /message 2/)
  assert.ok(!inbox.includes('spam'), 'honeypot submissions are not stored')
})

test('login attempts are capped at 10 per address', async () => {
  // 2 attempts have been spent above (one wrong, one right)
  for (let i = 0; i < 8; i++) await post('/admin/login', { password: 'nope' })
  const blocked = await post('/admin/login', { password: 'correct horse' })
  assert.equal(blocked.status, 429, 'even the right password is refused once the limit is hit')
})

test('admin can refresh the feeds and sees why a refresh failed', async () => {
  const cookie = await login()
  const r = await post('/admin/feeds/refresh', {}, { cookie })
  assert.equal(r.status, 302)
  assert.equal(r.headers.get('location'), '/admin/settings')
  const page = await (await get('/admin/settings', { cookie })).text()
  assert.match(page, /Live stats/)
  // the test box has no key, so the gated API refuses: the admin must be told, not left guessing
  assert.match(page, /last attempt failed: .*status 403|nothing fetched yet/)
  assert.match(page, /GitHub activity · no GitHub link set/)
  assert.match(page, /Refresh both now/)
})

test('the stats badge is an SVG with a short cache life, in both themes', async () => {
  const r = await get('/badge/stats.svg')
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /image\/svg\+xml/)
  assert.match(r.headers.get('cache-control'), /max-age=1800/)
  const svg = await r.text()
  assert.match(svg, /^<svg /)
  assert.match(svg, /Annie/)
  const light = await (await get('/badge/stats.svg?theme=light')).text()
  assert.match(light, /fill="#ffffff"/)
  assert.doesNotMatch(svg, /fill="#ffffff"/)
})
