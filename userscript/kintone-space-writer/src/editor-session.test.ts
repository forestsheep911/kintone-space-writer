import { describe, expect, it } from 'vitest'

import { canWriteEditor, sessionEnds, sessionKey } from './editor-session'

describe('local-authoritative editor sessions', () => {
  const target = { origin: 'https://2water.cybozu.com', spaceId: '10', threadId: '12' }
  const key = sessionKey(target, 'article-a')

  it('allows an empty editor to start a session but protects non-empty unrelated content', () => {
    expect(canWriteEditor(null, key, 'hash-1', false)).toBe(true)
    expect(canWriteEditor(null, key, 'hash-1', true)).toBe(false)
  })

  it('replaces a non-empty editor only with a new revision from the active article session', () => {
    expect(canWriteEditor({ key, articleId: 'article-a', hash: 'hash-1' }, key, 'hash-2', true)).toBe(true)
    expect(canWriteEditor({ key, articleId: 'article-a', hash: 'hash-1' }, key, 'hash-1', true)).toBe(false)
    expect(canWriteEditor({ key, articleId: 'article-a', hash: 'hash-1' }, sessionKey(target, 'article-b'), 'hash-2', true)).toBe(false)
  })

  it('ends only after the native editor disappears', () => {
    expect(sessionEnds(true)).toBe(false)
    expect(sessionEnds(false)).toBe(true)
  })
})
