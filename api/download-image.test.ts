import { describe, expect, it } from 'vitest';
import { isBlockedHost } from './download-image';

describe('download-image network boundary', () => {
    it.each([
        'localhost',
        '127.0.0.1',
        '10.1.2.3',
        '172.16.2.3',
        '192.168.1.1',
        '169.254.169.254',
        '::1',
        'fc00::1',
        'fe80::1',
        '::ffff:127.0.0.1',
    ])('blocks private or local address %s', (host) => {
        expect(isBlockedHost(host)).toBe(true);
    });

    it.each([
        'images.unsplash.com',
        'fcdn.example.com',
        '8.8.8.8',
        '2606:4700:4700::1111',
    ])('allows a public address or hostname %s', (host) => {
        expect(isBlockedHost(host)).toBe(false);
    });
});
