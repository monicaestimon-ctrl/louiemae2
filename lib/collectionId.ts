/** Stable public collection path segment; shared by saves and metadata routing. */
export function isCollectionId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
}
