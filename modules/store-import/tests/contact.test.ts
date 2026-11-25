// The footer's contact details become the text of a Contact page.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contactHtml, readContactLines } from '../src/contact'

const footer = `<footer><div><h2><strong>CONTACT US :</strong></h2><div class="rte"><p></p>
  <ul><li>Hotline: +88 09658761394</li><li>Email: shop@example.com</li><li>Location: &nbsp;Dhaka-1310</li></ul></div></div>
  <div><h2><strong>INFORMATIONS :</strong></h2><ul><li><a href="/policies/privacy-policy">Privacy</a></li></ul></div></footer>`

test('reads the lines of the footer block headed Contact, and no other block', () => {
  assert.deepEqual(readContactLines(footer), [
    'Hotline: +88 09658761394',
    'Email: shop@example.com',
    'Location: Dhaka-1310',
  ])
  assert.deepEqual(readContactLines('<footer><h2>Links</h2><ul><li>Privacy</li></ul></footer>'), [])
})

test('makes the page body: escaped, with the email address as a link', () => {
  assert.equal(
    contactHtml(['Email: shop@example.com', '<b>x</b>']),
    '<ul><li>Email: <a href="mailto:shop@example.com">shop@example.com</a></li><li>&lt;b&gt;x&lt;/b&gt;</li></ul>',
  )
})
