import { describe, expect, it } from 'vitest'

import { editorSessionChanged } from './editor-image-session'

describe('editor image session', () => {
  it('keeps image uploads only for the same live editor node', () => {
    const editor = {}
    expect(editorSessionChanged(null, editor)).toBe(true)
    expect(editorSessionChanged(editor, editor)).toBe(false)
    expect(editorSessionChanged(editor, {})).toBe(true)
  })
})
