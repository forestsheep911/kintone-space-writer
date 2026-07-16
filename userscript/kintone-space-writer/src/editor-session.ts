export type EditorSessionTarget = {
  origin: string
  spaceId: string
  threadId: string
}

export type ActiveEditorSession = {
  key: string
  articleId: string
  hash: string
}

export function sessionKey(target: EditorSessionTarget, articleId: string) {
  return JSON.stringify([target.origin, target.spaceId, target.threadId, articleId])
}

export function canWriteEditor(
  activeSession: ActiveEditorSession | null,
  key: string,
  hash: string,
  editorHasText: boolean,
) {
  if (activeSession?.hash === hash) return false
  if (!editorHasText) return true
  return activeSession?.key === key
}

export function sessionEnds(editorExists: boolean) {
  return !editorExists
}
