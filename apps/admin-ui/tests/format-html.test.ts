// The source view's HTML formatting (src/lib/format-html.ts)
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatHtml } from '../src/lib/format-html'

describe('formatHtml', () => {
  test('puts block elements on their own, indented lines', async () => {
    assert.equal(
      await formatHtml('<ul><li><p>a</p></li><li><p>b</p></li></ul>'),
      '<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>',
    )
  })

  test('keeps the spaces around inline elements, so the page renders the same', async () => {
    assert.equal(
      await formatHtml('<p>Hello <strong>big</strong> world</p><blockquote><p>q</p></blockquote>'),
      '<p>Hello <strong>big</strong> world</p>\n<blockquote><p>q</p></blockquote>',
    )
  })

  test('leaves what is inside <pre> exactly as it is', async () => {
    const out = await formatHtml('<pre><code>a  b\n  c</code></pre><p>x</p>')
    assert.ok(out.startsWith('<pre><code>a  b\n  c</code></pre>'), out)
  })

  test('formatting does not change the text of the content', async () => {
    const html =
      '<h2>Title</h2><p>One <a href="https://x.test/a?b=1&amp;c=2">link</a>, two.</p><ol><li><p>x</p></li></ol>'
    // Whitespace between blocks is not content (the test above covers the spaces inside a paragraph)
    const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
    assert.equal(text(await formatHtml(html)), text(html))
  })

  test('empty content stays empty; markup it cannot format is returned, not thrown', async () => {
    assert.equal(await formatHtml(''), '')
    assert.equal(await formatHtml('   '), '   ')
    assert.equal(typeof (await formatHtml('<p>unclosed <b>x')), 'string')
  })
})
