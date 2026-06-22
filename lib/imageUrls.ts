const SUPPLIER_IMAGE_HOSTS = [
  'alicdn.com',
  'aliexpress-media.com',
  'aliexpress.com',
  '1688.com',
  'cjdropshipping.com',
];

export function normalizeImageUrl(src?: string | null): string {
  const value = String(src || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('convex-storage:')) {
    const storageId = value.replace(/^convex-storage:/, '').trim();
    const convexUrl = import.meta.env.VITE_CONVEX_URL || '';
    return convexUrl && storageId ? `${convexUrl.replace(/\/$/, '')}/api/storage/${storageId}` : value;
  }
  return value;
}

export function isHttpImageUrl(src?: string | null): boolean {
  const normalized = normalizeImageUrl(src);
  return /^https?:\/\//i.test(normalized);
}

export function isDurableImageUrl(src?: string | null): boolean {
  const normalized = normalizeImageUrl(src);
  if (!normalized) return false;
  if (normalized.startsWith('/images/') || normalized.startsWith('data:image/')) return true;
  if (!/^https?:\/\//i.test(normalized)) return false;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host.includes('convex.cloud') || host.includes('convex.site') || host.includes('louiemae.com');
  } catch {
    return false;
  }
}

export function isSupplierImageUrl(src?: string | null): boolean {
  const normalized = normalizeImageUrl(src);
  if (!/^https?:\/\//i.test(normalized)) return false;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return SUPPLIER_IMAGE_HOSTS.some((supplierHost) => host === supplierHost || host.endsWith(`.${supplierHost}`));
  } catch {
    return false;
  }
}

export function shouldCacheImageUrl(src?: string | null): boolean {
  const normalized = normalizeImageUrl(src);
  return isHttpImageUrl(normalized) && !isDurableImageUrl(normalized);
}

export function getImageProxyUrl(src?: string | null, filename = 'product-image'): string {
  const normalized = normalizeImageUrl(src);
  if (!isHttpImageUrl(normalized)) return normalized;
  return `/api/download-image?disposition=inline&url=${encodeURIComponent(normalized)}&filename=${encodeURIComponent(filename)}`;
}
