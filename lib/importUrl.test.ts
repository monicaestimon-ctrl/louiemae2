import { describe, expect, it } from 'vitest';
import { normalizeProductImportUrl, parseProductImportUrls } from './importUrl';

describe('normalizeProductImportUrl', () => {
  it('keeps complete http and https URLs unchanged apart from trimming', () => {
    expect(normalizeProductImportUrl(' https://example.com/products/1 ')).toBe('https://example.com/products/1');
    expect(normalizeProductImportUrl('http://example.com/products/1')).toBe('http://example.com/products/1');
  });

  it('adds https to bare product URLs', () => {
    expect(normalizeProductImportUrl('example.com/products/1')).toBe('https://example.com/products/1');
  });

  it('normalizes protocol-relative URLs to https', () => {
    expect(normalizeProductImportUrl('//example.com/products/1')).toBe('https://example.com/products/1');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeProductImportUrl('   ')).toBe('');
  });
});

describe('parseProductImportUrls', () => {
  it('accepts newline, space, and comma-separated URLs and removes duplicates', () => {
    expect(parseProductImportUrls('1688.com/a\nhttps://example.com/b, 1688.com/a')).toEqual([
      'https://1688.com/a',
      'https://example.com/b',
    ]);
  });

  it('repairs a Notes line-wrap inside an encoded 1688 query string', () => {
    const wrapped =
      'https://detail.1688.com/offer/922839791630.html?topicCode=abc&optName=%E8%B6%8B%E5%8A%BF%\n' +
      'E5%95%86%E6%9C%BA&topicName=%E5%A5%B3%E5%A3%AB&offerId=922839791630';

    expect(parseProductImportUrls(wrapped)).toEqual([
      'https://detail.1688.com/offer/922839791630.html?topicCode=abc&optName=%E8%B6%8B%E5%8A%BF%E5%95%86%E6%9C%BA&topicName=%E5%A5%B3%E5%A3%AB&offerId=922839791630',
    ]);
  });

  it('still accepts multiple complete URLs separated by spaces on one line', () => {
    expect(parseProductImportUrls('https://example.com/a https://example.com/b')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});
