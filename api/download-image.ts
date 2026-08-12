import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

const expandIpv6 = (value: string): number[] | null => {
    let host = value;
    const dottedTail = host.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (dottedTail) {
        const octets = dottedTail.split('.').map(Number);
        if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
            return null;
        }
        const hexTail = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
        host = `${host.slice(0, -dottedTail.length)}${hexTail}`;
    }

    const halves = host.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
    if (missing < 0 || (halves.length === 1 && head.length !== 8)) return null;
    const groups = [...head, ...Array(missing).fill('0'), ...tail].map(part => Number.parseInt(part || '0', 16));
    return groups.length === 8 && groups.every(group => Number.isInteger(group) && group >= 0 && group <= 0xffff)
        ? groups
        : null;
};

export const isBlockedHost = (hostname: string) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;

    const family = isIP(host);
    if (family === 0) return false;
    if (family === 6) {
        const groups = expandIpv6(host);
        if (!groups) return true;
        const allLeadingGroupsZero = groups.slice(0, 7).every(group => group === 0);
        if (allLeadingGroupsZero && (groups[7] === 0 || groups[7] === 1)) return true;
        if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80) return true;
        const mappedIpv4 = groups.slice(0, 5).every(group => group === 0)
            && (groups[5] === 0xffff || groups[5] === 0);
        if (mappedIpv4) {
            const high = groups[6];
            const low = groups[7];
            return isBlockedHost(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
        }
        return false;
    }

    return (
        host === '0.0.0.0' ||
        host === '127.0.0.1' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('169.254.') ||
        host.startsWith('100.64.') ||
        host.startsWith('198.18.') ||
        host.startsWith('198.19.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
};

const resolvePublicAddress = async (value: URL) => {
    if (!['http:', 'https:'].includes(value.protocol) || isBlockedHost(value.hostname)) {
        throw new Error('Unsupported image URL');
    }
    const literalFamily = isIP(value.hostname);
    const addresses = literalFamily
        ? [{ address: value.hostname, family: literalFamily }]
        : await lookup(value.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isBlockedHost(address))) {
        throw new Error('Image host did not resolve to a public address');
    }
    return addresses[0];
};

const requestPinned = async (url: URL, timeoutMs: number): Promise<IncomingMessage> => {
    const resolved = await resolvePublicAddress(url);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return await new Promise((resolve, reject) => {
        const upstream = request(url, {
            method: 'GET',
            headers: {
                accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'user-agent': 'LouieMaeAdminImageDownloader/1.0',
            },
            // Pin the verified address for this request so DNS cannot resolve to
            // a private address between validation and connection.
            lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
                if (options.all) {
                    callback(null, [resolved]);
                    return;
                }
                callback(null, resolved.address, resolved.family);
            }) as never,
        }, resolve);
        upstream.setTimeout(timeoutMs, () => upstream.destroy(new Error('Image request timed out')));
        upstream.once('error', reject);
        upstream.end();
    });
};

const fetchPublicImage = async (initialUrl: URL): Promise<IncomingMessage> => {
    let currentUrl = initialUrl;
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('Image request timed out');
        const response = await requestPinned(currentUrl, remainingMs);
        const status = response.statusCode || 502;
        if (status < 300 || status >= 400) return response;
        const location = response.headers.location;
        if (!location || redirect === MAX_REDIRECTS) {
            response.destroy();
            throw new Error('Image URL redirected too many times');
        }
        response.destroy();
        const nextUrl = new URL(location, currentUrl);
        if (currentUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
            throw new Error('Image URL cannot downgrade from HTTPS');
        }
        if (!['http:', 'https:'].includes(nextUrl.protocol) || isBlockedHost(nextUrl.hostname)) {
            throw new Error('Unsupported image redirect URL');
        }
        currentUrl = nextUrl;
    }
    throw new Error('Unable to fetch image');
};

const safeFilename = (value: string | undefined, fallback: string) => {
    const base = (value || fallback).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    return base || fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
    const rawFilename = Array.isArray(req.query.filename) ? req.query.filename[0] : req.query.filename;
    const rawDisposition = Array.isArray(req.query.disposition) ? req.query.disposition[0] : req.query.disposition;

    if (!rawUrl) {
        res.status(400).json({ error: 'Missing image URL' });
        return;
    }

    let imageUrl: URL;
    try {
        imageUrl = new URL(rawUrl);
    } catch {
        res.status(400).json({ error: 'Invalid image URL' });
        return;
    }

    let response: IncomingMessage;
    try {
        response = await fetchPublicImage(imageUrl);
    } catch {
        res.status(400).json({ error: 'Unsupported or unreachable image URL' });
        return;
    }

    const responseStatus = response.statusCode || 502;
    if (responseStatus < 200 || responseStatus >= 300) {
        response.resume();
        res.status(responseStatus).json({ error: 'Unable to fetch image' });
        return;
    }

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
        response.destroy();
        res.status(415).json({ error: 'URL did not return an image' });
        return;
    }

    const contentLength = Number(response.headers['content-length'] || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
        response.destroy();
        res.status(413).json({ error: 'Image is too large to download' });
        return;
    }

    const extension = contentType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'jpg';
    const filename = safeFilename(rawFilename, `product-image.${extension}`);
    const filenameWithExtension = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${extension}`;

    const inline = rawDisposition === 'inline' && !contentType.toLowerCase().startsWith('image/svg');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filenameWithExtension}"`);
    res.setHeader(
        'Cache-Control',
        inline
            ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000'
            : 'private, max-age=300',
    );
    res.status(200);
    let bytesRead = 0;
    const limiter = new Transform({
        transform(chunk, _encoding, callback) {
            bytesRead += chunk.length;
            if (bytesRead > MAX_IMAGE_BYTES) {
                callback(new Error('IMAGE_TOO_LARGE'));
                return;
            }
            callback(null, chunk);
        },
    });
    try {
        await pipeline(
            response,
            limiter,
            res,
        );
    } catch (error) {
        console.warn('[download-image] Upstream image stream failed', {
            reason: error instanceof Error ? error.message : 'unknown',
            hostname: imageUrl.hostname,
            bytesRead,
        });
        if (!res.headersSent) {
            res.setHeader('Cache-Control', 'no-store');
            res.removeHeader('Content-Disposition');
            res.removeHeader('Content-Type');
            res.status(error instanceof Error && error.message === 'IMAGE_TOO_LARGE' ? 413 : 502)
                .json({ error: 'Unable to stream image' });
        } else {
            res.destroy();
        }
    }
}
