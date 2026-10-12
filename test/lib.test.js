import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esc, md, slugify, fill, list } from '../lib.js'

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
