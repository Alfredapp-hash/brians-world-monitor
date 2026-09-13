/**
 * The Public Dispatch — brand & community links.
 * One place to update identity links for the whole app.
 *
 * This is the USER-VISIBLE identity only. The repository, package name, API
 * paths and proto services stay on their original WorldMonitor names on
 * purpose — renaming those is a deploy-surface change, not a rebrand.
 */
export const BRAND = {
  name: 'The Public Dispatch',
  shortName: 'TPD',
  /** Public home of the paper. */
  domain: 'thepublicdispatch.com',
  /** Community Discord invite. Update with your real invite link. */
  discordInvite: 'https://discord.gg/BCHZDq8Xt',
  /** Source repository (AGPL-3.0 — keep public while the site is public). */
  github: 'https://github.com/Alfredapp-hash/brians-world-monitor',
  /** X (Twitter) profile. */
  x: 'https://x.com/JSAsmonitor',
  /** Landing page path. */
  about: '/about.html',
  /** Public NCI methodology explainer. */
  methodology: '/methodology.html',
  /** Public OSINT tools directory. */
  osint4all: '/osint4all.html',
  /** Upstream project this fork is based on (credit + AGPL lineage). */
  upstream: 'https://github.com/koala73/worldmonitor',
} as const;

/** Canonical public origin for marketing, OG, and share links — never an API host. */
export const PUBLIC_ORIGIN = `https://${BRAND.domain}` as const;
export const PUBLIC_WWW_ORIGIN = `https://www.${BRAND.domain}` as const;
export const PUBLIC_PRO_URL = `${PUBLIC_ORIGIN}/pro` as const;
export const PUBLIC_MCP_URL = `${PUBLIC_ORIGIN}/mcp` as const;

export function isPublicWebHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === BRAND.domain
    || host === `www.${BRAND.domain}`
    || host.endsWith('.netlify.app');
}
