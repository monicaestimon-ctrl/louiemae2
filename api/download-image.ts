import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const isBlockedHost = (hostname: string) => {
    const host = hostname.toLowerCase();
    return (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '0.0.0.0' ||
        host === '127.0.0.1' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        host === '::1' ||
        host === '[::1]'
    );
};

const safeFilename = (value: string | undefined, fallback: string) => {
    const base = (value || fallback).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    return base || fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    if (!['http:', 'https:'].includes(imageUrl.protocol) || isBlockedHost(imageUrl.hostname)) {
        res.status(400).json({ error: 'Unsupported image URL' });
        return;
    }

    const response = await fetch(imageUrl.toString(), {
        headers: {
            accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'user-agent': 'LouieMaeAdminImageDownloader/1.0',
        },
    });

    if (!response.ok || !response.body) {
        res.status(response.status || 502).json({ error: 'Unable to fetch image' });
        return;
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
        res.status(415).json({ error: 'URL did not return an image' });
        return;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: 'Image is too large to download' });
        return;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: 'Image is too large to download' });
        return;
    }

    const extension = contentType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg') || 'jpg';
    const filename = safeFilename(rawFilename, `product-image.${extension}`);
    const filenameWithExtension = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${extension}`;

    const inline = rawDisposition === 'inline';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filenameWithExtension}"`);
    res.setHeader('Cache-Control', inline ? 'public, max-age=86400, stale-while-revalidate=604800' : 'private, max-age=300');
    res.status(200).send(Buffer.from(bytes));
}
