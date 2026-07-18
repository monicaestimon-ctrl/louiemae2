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
});
