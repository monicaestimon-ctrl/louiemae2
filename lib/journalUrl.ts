/** Published article identities remain stable when titles change. */
export const journalUrl = (id: string) => `/blog/${encodeURIComponent(id)}`;
