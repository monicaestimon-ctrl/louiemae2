import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export const isBlockedHost = (hostname: string) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;

    const family = isIP(host);
    if (family === 0) return false;
    if (family === 6) {
        if (host === '::' || host === '::1') return true;
        if (host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
        if (host.startsWith('::ffff:')) return isBlockedHost(host.slice('::ffff:'.length));
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

const requestPinned = async (url: URL): Promise<IncomingMessage> => {
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
            lookup: ((_hostname: string, _options: unknown, callback: (...args: unknown[]) => void) => {
                callback(null, resolved.address, resolved.family);
            }) as never,
        }, resolve);
        upstream.setTimeout(15_000, () => upstream.destroy(new Error('Image request timed out')));
        upstream.once('error', reject);
        upstream.end();
    });
};

const fetchPublicImage = async (initialUrl: URL): Promise<IncomingMessage> => {
    let currentUrl = initialUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const response = await requestPinned(currentUrl);
        const status = response.statusCode || 502;
        if (status < 300 || status >= 400) return response;
        const location = response.headers.location;
        if (!location || redirect === MAX_REDIRECTS) {
            response.destroy();
            throw new Error('Image URL redirected too many times');
        }
        response.resume();
        currentUrl = new URL(location, currentUrl);
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
        res.status(415).json({ error: 'URL did not return an image' });
        return;
    }

    const contentLength = Number(response.headers['content-length'] || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: 'Image is too large to download' });
        return;
    }

    const extension = contentType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'jpg';
    const filename = safeFilename(rawFilename, `product-image.${extension}`);
    const filenameWithExtension = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${extension}`;

    const inline = rawDisposition === 'inline';
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
            res.status(error instanceof Error && error.message === 'IMAGE_TOO_LARGE' ? 413 : 502)
                .json({ error: 'Unable to stream image' });
        } else {
            res.destroy();
        }
    }
}
