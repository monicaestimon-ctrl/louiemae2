import { parse } from 'parse5';
/** Require one identity embedded by the build in the served document, not a separate request. */
export function documentCommit(html, expected) {
  const values = [];
  function visit(node) {
    if (node.tagName === 'meta') {
      const a = Object.fromEntries(node.attrs.map((x) => [x.name, x.value]));
      if (a.name === 'lm-build-commit') values.push(a.content);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  if (!/^[a-f0-9]{40}$/.test(expected ?? '') || values.length !== 1 || values[0] !== expected)
    throw Error('Audited document does not identify the expected release');
  return values[0];
}
/** Capture all main-document responses, including a transient deployment between endpoint checks. */
export function captureDocuments(page, expectedUrl, expectedCommit) {
  const pending = [];
  let navigatedAway = false;
  const navigation = (frame) => {
    if (frame === page.mainFrame() && frame.url() !== expectedUrl && frame.url() !== 'about:blank')
      navigatedAway = true;
  };
  const response = (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame())
      pending.push(
        (async () => ({
          url: r.url(),
          status: r.status(),
          commit: documentCommit(await r.text(), expectedCommit),
        }))().catch(() => ({ error: 'Invalid document identity' }))
      );
  };
  page.on('framenavigated', navigation);
  page.on('response', response);
  return {
    async verify() {
      const rows = await Promise.all(pending);
      if (
        navigatedAway ||
        page.url() !== expectedUrl ||
        !rows.length ||
        rows.some((r) => r.error || r.url !== expectedUrl || r.status !== 200)
      )
        throw Error('Audited page changed route or release');
      return { commit: expectedCommit, documents: rows.length, url: expectedUrl };
    },
    dispose() {
      page.off('framenavigated', navigation);
      page.off('response', response);
    },
  };
}
