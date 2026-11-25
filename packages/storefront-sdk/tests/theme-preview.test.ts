// The messages between the theme editor and a storefront's preview: what each side accepts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  THEME_EDITOR_SOURCE,
  THEME_PREVIEW_SOURCE,
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
