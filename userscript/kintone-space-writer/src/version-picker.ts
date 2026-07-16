export type VersionSummary = {
  id: string
  createdAt: string
}

export function imageCacheKey(digest: string, width: number) {
  return `${digest}:${width}`
}

export function newestVersionsFirst<T extends VersionSummary>(versions: T[]) {
  return [...versions].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
