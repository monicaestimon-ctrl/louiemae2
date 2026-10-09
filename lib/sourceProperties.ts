/** Legacy ASCII-key maps remain readable; new writes use values for supplier labels. */
export type SourcePropertyEntry = { key: string; value: string };
export type SourceProperties = Record<string, string> | SourcePropertyEntry[];
export function sourcePropertyEntries(properties?: SourceProperties): SourcePropertyEntry[] {
  return Array.isArray(properties)
    ? properties.map(({ key, value }) => ({ key, value }))
    : Object.entries(properties ?? {}).map(([key, value]) => ({ key, value }));
}
export function serializeSourceProperties(properties?: SourceProperties): SourcePropertyEntry[] | undefined {
  return properties === undefined ? undefined : sourcePropertyEntries(properties);
}