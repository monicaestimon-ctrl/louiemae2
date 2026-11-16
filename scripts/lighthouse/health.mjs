/** Inspect the audited tab without reloading it or accepting a late ready marker. */
export async function inspectRouteHealth(page, route) {
  const markers = await page.$$(route.readySelector);
  const readyAtAuditEnd = markers.length === 1;
  // content-visibility:auto excludes off-screen sections from innerText. Reveal
  // the existing ready section after measurement, then inspect rendered content.
  // A section that only becomes ready after scrolling must not rescue this run.
  if (readyAtAuditEnd) {
    await markers[0].scrollIntoView();
    await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  }
  const markerVisible = readyAtAuditEnd && await markers[0].isVisible();
  const body = await page.$eval('body', element => element.innerText);
  return {
    readyAtAuditEnd,
    markerVisible,
    ok: markerVisible && body.includes(route.requiredText)
      && !/Something went wrong|temporarily unavailable|Opening House of Louie Mae|restocked\. Please/i.test(body),
  };
}
