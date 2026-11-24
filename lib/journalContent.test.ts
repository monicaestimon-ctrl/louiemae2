import { expect, it } from 'vitest';
import { journalHtml } from './journalContent';
import { journalUrl } from './journalUrl';
it('keeps readable formatting and links while removing executable content and private DOM hooks', () => {
  const result = journalHtml(
    '<h1>Title &amp; text</h1><p id="root" onclick="attack()">Hello <strong>world</strong></p><script>attack()</script><a href="javascript:attack()">bad link</a><a href="/shop" target="_blank">Shop</a><img src="https://example.com/photo.jpg" onerror="attack()" alt="Photo"><svg><a href="javascript:attack()">x</a></svg>'
  );
  expect(result).toContain('<h2>Title &amp; text</h2>');
  expect(result).toContain('<p id="lm-journal-fragment-root">Hello <strong>world</strong></p>');
  expect(result).toContain('href="https://louiemae.com/shop"');
  expect(result).toContain('alt="Photo"');
  expect(journalHtml(result)).toBe(result);
  for (const value of [
    'attack()',
    'javascript:',
    'onclick',
    'onerror',
    'id="root"',
    '<svg',
    '<script',
  ])
    expect(result).not.toContain(value);
});
it('rejects encoded protocols, foreign content and oversized input without changing canonical identity', () => {
  expect(
    journalHtml(
      '<a href="java&#x09;script:alert(1)">text</a><math><mtext><img src=x onerror=alert(1)></mtext></math>'
    )
  ).toBe('text');
  expect(() => journalHtml('x'.repeat(1_000_001))).toThrow();
  expect(() => journalHtml('<div>'.repeat(102) + 'text' + '</div>'.repeat(102))).toThrow();
  expect(journalUrl('one/two')).toBe('/blog/one%2Ftwo');
  expect(journalHtml('<h2 id="section">Heading</h2><a href="#section">Read section</a>')).toContain(
    'href="#lm-journal-fragment-section"'
  );
});

it('preserves safe fragment targets when removing missing or unsafe anchor destinations', () => {
  const result = journalHtml('<a id="section"></a><a href="#section">Read</a><a id="other" href="javascript:bad()"><strong>Other</strong></a><a id="bad id">Plain</a>');
  expect(result).toContain('<span id="lm-journal-fragment-section"></span>');
  expect(result).toContain('href="#lm-journal-fragment-section"');
  expect(result).toContain('<span id="lm-journal-fragment-other"><strong>Other</strong></span>');
  expect(result).not.toMatch(/javascript:|bad id|<a id=/);
  expect(result).toContain('Plain');
  expect(journalHtml(result)).toBe(result);
});
