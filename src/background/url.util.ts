/**
 * URL normalization helpers.
 * Canonicalizes rotation page URLs so variants differing only by trailing slash or hash
 * are treated as identical. Prevents duplicate tab creation after browser session restore
 * (e.g. https://example.com vs https://example.com/). File URLs are left untouched.
 */
export function canonicalizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return raw ?? undefined;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      let path = u.pathname || '/';
      if (path.length > 1) path = path.replace(/\/+$/,'');
      u.pathname = path;
      u.hash = '';
    }
    let out = u.toString();
    // Normalize origin-only root to no trailing slash for matching consistency
    if (out.endsWith('/') && (u.pathname === '/' || u.pathname === '')) {
      out = out.replace(/\/+$/,'');
    }
    return out;
  } catch {
    return raw.replace(/\/+$/,'');
  }
}
