// The messages between the theme editor and a storefront's preview: what each side accepts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  THEME_EDITOR_SOURCE,
  PREVIEW_BLOCKED_SELECTOR,
  THEME_PREVIEW_SOURCE,
  connectThemePreview,
  isThemeEditorMessage,
  isThemePreviewMessage,
} from '../src/theme-preview'

describe('editor → storefront', () => {
  test('select names a section, and optionally one of its blocks', () => {
    assert.equal(isThemeEditorMessage({ source: THEME_EDITOR_SOURCE, type: 'select', sectionId: 's1' }), true)
    assert.equal(
      isThemeEditorMessage({ source: THEME_EDITOR_SOURCE, type: 'select', sectionId: 's1', blockId: 'b1' }),
      true,
    )
    assert.equal(
      isThemeEditorMessage({ source: THEME_EDITOR_SOURCE, type: 'select', sectionId: 's1', blockId: 4 }),
      false,
    )
    assert.equal(isThemeEditorMessage({ source: THEME_EDITOR_SOURCE, type: 'select' }), false)
  })

  test('only the editor’s own messages count', () => {
    assert.equal(isThemeEditorMessage({ source: 'someone-else', type: 'reload' }), false)
    assert.equal(isThemeEditorMessage(null), false)
  })
})

describe('storefront → editor', () => {
  test('ready, and a click on a section (or a block)', () => {
    assert.equal(isThemePreviewMessage({ source: THEME_PREVIEW_SOURCE, type: 'ready' }), true)
    assert.equal(isThemePreviewMessage({ source: THEME_PREVIEW_SOURCE, type: 'select', sectionId: 's1' }), true)
    assert.equal(
      isThemePreviewMessage({ source: THEME_PREVIEW_SOURCE, type: 'select', sectionId: 's1', blockId: 'b1' }),
      true,
    )
  })

  test('refuses a click without a section, or with a block that is not a string', () => {
    assert.equal(isThemePreviewMessage({ source: THEME_PREVIEW_SOURCE, type: 'select' }), false)
    assert.equal(
      isThemePreviewMessage({ source: THEME_PREVIEW_SOURCE, type: 'select', sectionId: 's', blockId: {} }),
      false,
    )
    assert.equal(isThemePreviewMessage({ source: 'someone-else', type: 'ready' }), false)
    assert.equal(isThemePreviewMessage({ source: THEME_PREVIEW_SOURCE, type: 'other' }), false)
  })
})

describe('the preview is for editing, not shopping', () => {
  type Handler = (event: unknown) => void
  const listeners: Record<string, Handler> = {}
  const posted: unknown[] = []
  Object.assign(globalThis, {
    Element: class {},
    sessionStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    document: {
      readyState: 'complete',
      addEventListener: (type: string, fn: Handler) => (listeners[type] = fn),
      removeEventListener() {},
      querySelector: () => null,
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      scrollTo() {},
      parent: { postMessage: (message: unknown) => posted.push(message) },
    },
  })
  connectThemePreview({ adminOrigin: 'http://admin.test' })

  // A target that is inside a section, and matches (or not) the blocked selector
  const click = (blocked: boolean) => {
    const calls = { prevented: false, stopped: false }
    const section = { getAttribute: () => 's1' }
    const target = Object.assign(Object.create(Element.prototype), {
      closest: (selector: string) =>
        selector === PREVIEW_BLOCKED_SELECTOR ? (blocked ? {} : null) : selector.includes('section') ? section : null,
    })
    listeners.click!({
      target,
      preventDefault: () => (calls.prevented = true),
      stopImmediatePropagation: () => (calls.stopped = true),
    })
    return calls
  }

  test('a blocked click (link, add to cart…) does nothing, but still picks the section', () => {
    posted.length = 0
    assert.deepEqual(click(true), { prevented: true, stopped: true })
    assert.equal(posted.length, 1)
  })

  test('another click (carousel arrow, tab) reaches the page', () => {
    assert.deepEqual(click(false), { prevented: false, stopped: false })
  })

  test('a form submit is stopped', () => {
    const calls = { prevented: false, stopped: false }
    listeners.submit!({
      preventDefault: () => (calls.prevented = true),
      stopImmediatePropagation: () => (calls.stopped = true),
    })
    assert.deepEqual(calls, { prevented: true, stopped: true })
  })

  test('the blocked selector names links, the cart buttons and submit buttons', () => {
    for (const part of ['a', '[data-add-to-cart]', '[data-line-qty]', 'input[type="submit"]']) {
      assert.ok(PREVIEW_BLOCKED_SELECTOR.split(', ').includes(part), part)
    }
  })
})
