import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esc, md, slugify, fill, list, round, newestShip } from '../lib.js'

test('esc neutralises every HTML special character', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  assert.equal(esc(null), '')
})

test('md: paragraphs, line breaks and inline marks', () => {
  assert.equal(md('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>')
  assert.equal(md('**b** *i* `c`'), '<p><strong>b</strong> <em>i</em> <code>c</code></p>')
  assert.equal(md('2*3*4 snake_case'), '<p>2*3*4 snake_case</p>', 'asterisks inside words are left alone')
  assert.equal(md('`**not bold**`'), '<p><code>**not bold**</code></p>', 'no formatting inside code')
})

test('md: links open externally only when they leave the site', () => {
  assert.equal(md('[a](https://x.y/z)'), '<p><a href="https://x.y/z" target="_blank" rel="noopener">a</a></p>')
  assert.equal(md('[a](/work/b)'), '<p><a href="/work/b">a</a></p>')
  assert.equal(md('[a](javascript:alert(1))'), '<p>[a](javascript:alert(1))</p>', 'unsafe schemes are not linked')
})

test('md: headings, lists, images and fenced code', () => {
  assert.equal(md('## Title'), '<h2>Title</h2>')
  assert.equal(md('### Sub **b**'), '<h3>Sub <strong>b</strong></h3>')
  assert.equal(md('# not a heading'), '<p># not a heading</p>', 'h1 is reserved for the page title')
  assert.equal(md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>')
  assert.equal(md('![Cap](/public/x.png)'),
    '<figure><img src="/public/x.png" alt="Cap" loading="lazy"><figcaption>Cap</figcaption></figure>')
  assert.equal(md('![](https://h/x.png)'), '<figure><img src="https://h/x.png" alt="" loading="lazy"></figure>')
  assert.equal(md('```\nconst a = 1\n\nif (a) {}\n```'), '<pre><code>const a = 1\n\nif (a) {}</code></pre>',
    'blank lines inside a fence do not split it')
})

test('md never lets HTML through', () => {
  const out = md('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![x](/a" onload="alert(1))')
  assert.ok(!out.includes('<script'))
  assert.ok(!out.includes('<img src=x'), 'a pasted tag is shown as text, not rendered')
  assert.ok(out.includes('&lt;img src=x onerror'))
  assert.ok(!out.includes('<img src="/a"'), 'image syntax with a quote in the URL is not an image')
  assert.ok(!out.includes('onload="'))
})

test('slugify', () => {
  assert.equal(slugify('  The Silent Co-Driver! '), 'the-silent-co-driver')
  assert.equal(slugify('x'.repeat(100)).length, 60)
  assert.equal(slugify(''), '')
})

test('fill and list', () => {
  assert.equal(fill('{{servers}} servers, {{nope}}', { servers: 307 }), '307 servers, {{nope}}')
  assert.deepEqual(list(' a, b ,, c '), ['a', 'b', 'c'])
})

test('parseContributions reads dates, levels and tooltip counts', async () => {
  const { parseContributions, streaks } = await import('../lib.js')
  const html = `
    <td data-date="2026-10-02" id="c-0-1" data-level="2" class="ContributionCalendar-day"></td>
    <td data-date="2026-10-01" id="c-0-0" data-level="0" class="ContributionCalendar-day"></td>
    <td data-date="2026-10-03" id="c-0-2" data-level="4" class="ContributionCalendar-day"></td>
    <td data-date="2026-10-04" id="c-0-3" data-level="0" class="ContributionCalendar-day"></td>
    <tool-tip for="c-0-0">No contributions on October 1st.</tool-tip>
    <tool-tip for="c-0-1">3 contributions on October 2nd.</tool-tip>
    <tool-tip for="c-0-2">12 contributions on October 3rd.</tool-tip>
    <tool-tip for="c-0-3">No contributions on October 4th.</tool-tip>`
  const { days, total } = parseContributions(html)
  assert.deepEqual(days.map(x => x.d), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], 'sorted by date')
  assert.deepEqual(days.map(x => x.n), [0, 3, 12, 0])
  assert.deepEqual(days.map(x => x.l), [0, 2, 4, 0])
  assert.equal(total, 15)
  assert.deepEqual(streaks(days), { current: 2, longest: 2 }, 'today empty still counts the run up to yesterday')
  assert.deepEqual(streaks(days.slice(0, 3)), { current: 2, longest: 2 })
  assert.deepEqual(streaks([{ n: 1 }, { n: 0 }, { n: 0 }]), { current: 0, longest: 1 })
  assert.deepEqual(parseContributions('<html></html>'), { days: [], total: 0 })
})

test('diagram figures open full size, other images do not', () => {
  assert.match(md('![Map](/public/diagrams/annie.svg)'), /^<figure class="diagram"><a href="\/public\/diagrams\/annie.svg" target="_blank" rel="noopener"><img/)
  assert.match(md('![Shot](/public/x.png)'), /^<figure><img src="\/public\/x.png"/)
})

test('text saved from a textarea (\\r\\n, trailing spaces) still renders images and paragraphs', () => {
  const out = md('Intro line\r\n\r\n![Map](/public/diagrams/annie.svg) \r\n\r\nOne\r\ntwo')
  assert.match(out, /<figure class="diagram">/)
  assert.ok(!out.includes('\r'))
  assert.match(out, /<p>One<br>two<\/p>$/)
})

test('round never claims more than the real count', () => {
  assert.equal(round(492), 'nearly 500')
  assert.equal(round(500), '500+')
  assert.equal(round(560), '500+')
  assert.equal(round(589), '500+')
  assert.equal(round(590), 'nearly 600')
  assert.equal(round(1240), '1,000+')
  assert.equal(round(42), '42')
})

test('last shipped takes the newest real commit across repos, not the most recently pushed repo', () => {
  const commit = (msg, date, login = 'yabhinav1') => ({ html_url: `https://x/${msg}`, author: { login }, commit: { message: msg, author: { date }, committer: { date } } })
  const ship = newestShip([
    // pushed most recently (a Dependabot branch), but its newest commit is old
    { repo: 'dailyos', commits: [commit('Make actions answer instantly', '2026-08-22T09:00:00Z')] },
    { repo: 'portfolio', commits: [
      commit('Refresh résumé PDF: new domain', '2026-10-16T13:00:00Z'),
      commit('Bump next', '2026-10-16T12:55:00Z', 'dependabot[bot]'),
      commit('Move the portfolio to yabhinav.is-a.dev\n\nbody', '2026-10-16T12:49:00Z'),
    ] },
  ])
  assert.equal(ship.repo, 'portfolio')
  assert.equal(ship.msg, 'Move the portfolio to yabhinav.is-a.dev')
  assert.equal(newestShip([{ repo: 'a', commits: [commit('Merge branch x', '2026-10-01T00:00:00Z')] }]), null)
})
