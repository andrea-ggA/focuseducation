import type { Components } from "react-markdown";

const SAFE_PROTOCOLS = new Set(["https:", "mailto:"]);
const REFERRAL_CODE_REGEX = /^[A-Z0-9-]{4,24}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "[::1]") return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map((n) => Number(n));
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  // fc00::/7 and fe80::/10 (IPv6 private/link-local)
  const compact = host.replace(/^\[|\]$/g, "");
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(compact)) return true;
  return false;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeFilename(input: string, fallback = "documento"): string {
  const normalized = input.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return normalized || fallback;
}

export function isSafeHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://example.com";
    const url = new URL(href, base);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return false;
    if (url.protocol === "mailto:") return true;
    return !isPrivateOrLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

export function isSafeShareToken(token: string | undefined): boolean {
  if (!token) return false;
  return /^[a-zA-Z0-9_-]{8,128}$/.test(token);
}

export function isSafeUuid(value: string | undefined): boolean {
  if (!value) return false;
  return UUID_REGEX.test(value);
}

export function normalizeReferralCode(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase() || "";
  return REFERRAL_CODE_REGEX.test(normalized) ? normalized : null;
}

export function safeOpenExternal(url: string): Window | null {
  if (typeof window === "undefined") return null;
  if (!isSafeHref(url)) return null;
  return window.open(url, "_blank", "noopener,noreferrer");
}

export function isSafeYouTubeUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    if (!SAFE_YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return false;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return false;
    if (url.hostname === "youtu.be") return url.pathname.length > 1;
    return url.pathname.startsWith("/watch") || url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/");
  } catch {
    return false;
  }
}

export const SAFE_MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    if (!isSafeHref(href)) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  img: () => null,
};
