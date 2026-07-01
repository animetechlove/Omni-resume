// ─────────────────────────────────────────────────────────────────────────────
// src/services/QRService.ts
// §14 — First-party platform QR tag system.
// Generates internal omniresume://platform-tag?id=<platform_id>&v=1 URLs.
// Reads them back with the device camera. Never touches a streaming platform.
// ─────────────────────────────────────────────────────────────────────────────

const QR_SCHEME   = 'omniresume';
const QR_HOST     = 'platform-tag';
const QR_VERSION  = '1';

// ─── URL GENERATION ──────────────────────────────────────────────────────────

/**
 * Generate the QR payload for a given platform.
 * This is a deterministic, static URL — no auth, no secrets. §14
 */
export function buildPlatformTagUrl(platformId: string): string {
  return `${QR_SCHEME}://${QR_HOST}?id=${encodeURIComponent(platformId)}&v=${QR_VERSION}`;
}

// ─── URL PARSING ─────────────────────────────────────────────────────────────

export interface ParsedPlatformTag {
  platform_id: string;
  version: string;
}

/**
 * Parse a scanned QR URL.
 * Returns null if the URL is not a valid Omni-Resume platform tag
 * (prevents accidentally acting on a non-first-party QR code).
 */
export function parsePlatformTagUrl(url: string): ParsedPlatformTag | null {
  try {
    // Use basic parsing since URL constructor may not be available in all RN versions
    if (!url.startsWith(`${QR_SCHEME}://${QR_HOST}`)) return null;

    const queryPart = url.split('?')[1] ?? '';
    const params = Object.fromEntries(
      queryPart.split('&').map(pair => pair.split('=').map(decodeURIComponent)),
    );

    if (!params.id || !params.v) return null;
    return { platform_id: params.id, version: params.v };
  } catch {
    return null;
  }
}

// ─── DEEP LINK HANDLER ───────────────────────────────────────────────────────

/**
 * Call this from the app's Linking handler when an omniresume:// URL arrives.
 * Routes platform-tag URLs into the QR flow; all other internal routes are
 * handled by the navigation system.
 */
export function handleInternalDeepLink(
  url: string,
  onPlatformTag: (platformId: string) => void,
): boolean {
  const parsed = parsePlatformTagUrl(url);
  if (parsed) {
    onPlatformTag(parsed.platform_id);
    return true;
  }
  return false;
}
