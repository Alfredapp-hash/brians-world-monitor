import { isDesktopRuntime, toApiUrl, toRuntimeUrl } from '../services/runtime';
import { getPersistentCache, setPersistentCache } from '../services/persistent-cache';

const isDev = import.meta.env.DEV;
const RESPONSE_CACHE_PREFIX = 'api-response:';

// RSS proxy: route directly to a self-hosted relay via CDN when enabled.
// Feature flag controls rollout; default off for safe staged deployment.
// This fork has no relay of its own, so VITE_RSS_RELAY_BASE_URL must be set
// explicitly for RSS_DIRECT_TO_RELAY to do anything — no hardcoded default
// pointing at a third party's infrastructure.
const RSS_DIRECT_TO_RELAY = import.meta.env.VITE_RSS_DIRECT_TO_RELAY === 'true';
const RSS_RELAY_BASE_URL = import.meta.env.VITE_RSS_RELAY_BASE_URL ?? '';
const RSS_PROXY_BASE = isDev
  ? '' // Dev uses Vite's rssProxyPlugin
  : RSS_DIRECT_TO_RELAY
    ? RSS_RELAY_BASE_URL
    : '';

// Widget agent proxy:
//   dev       → Vite proxy /widget-agent → api/widget-agent.ts's configured relay (if any)
//   desktop   → this fork's own deployed /api/widget-agent (Vercel edge), same as prod web
//   prod web  → /api/widget-agent (Vercel edge) → validates Clerk JWT or tester keys,
//               then proxies SSE to a relay ONLY if WIDGET_RELAY_BASE is configured server-side
//
// Previously this hardcoded https://proxy.worldmonitor.app for desktop builds —
// a third-party relay this fork doesn't own or control, called directly from the
// shipped client with no server-side gating. Routed through toApiUrl() instead so
// desktop goes through the same fail-closed server check as prod web (api/widget-agent.ts
// returns 503 when no relay is configured, instead of a client silently reaching a
// competitor's infrastructure).
export function widgetAgentUrl(): string {
  if (isDev) return '/widget-agent';
  if (isDesktopRuntime()) return toApiUrl('/api/widget-agent');
  return '/api/widget-agent';
}

export function widgetAgentHealthUrl(): string {
  if (isDev) return '/widget-agent/health';
  if (isDesktopRuntime()) return toApiUrl('/api/widget-agent');
  return '/api/widget-agent'; // Vercel handler: GET → relay /widget-agent/health
}

export function rssProxyUrl(feedUrl: string): string {
  if (isDesktopRuntime()) return proxyUrl(feedUrl);
  if (RSS_PROXY_BASE) {
    return `${RSS_PROXY_BASE}/rss?url=${encodeURIComponent(feedUrl)}`;
  }
  return `/api/rss-proxy?url=${encodeURIComponent(feedUrl)}`;
}

type CachedResponsePayload = {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

// In production browser deployments, routes are handled by Vercel serverless functions.
// In local dev, Vite proxy handles these routes.
// In Tauri desktop mode, route requests need an absolute remote host.
export function proxyUrl(localPath: string): string {
  if (isDesktopRuntime()) {
    return toRuntimeUrl(localPath);
  }

  if (isDev) {
    return localPath;
  }

  return toApiUrl(localPath);
}

function shouldPersistResponse(url: string): boolean {
  return url.startsWith('/api/');
}

function buildResponseCacheKey(url: string): string {
  return `${RESPONSE_CACHE_PREFIX}${url}`;
}

function toCachedPayload(url: string, response: Response, body: string): CachedResponsePayload {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    url,
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}

function toResponse(payload: CachedResponsePayload): Response {
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers,
  });
}

async function fetchAndPersist(url: string): Promise<Response> {
  const response = await fetch(proxyUrl(url));
  if (response.ok && shouldPersistResponse(url)) {
    try {
      const body = await response.clone().text();
      void setPersistentCache(buildResponseCacheKey(url), toCachedPayload(url, response, body));
    } catch (error) {
      console.warn('[proxy] Failed to persist API response cache', error);
    }
  }
  return response;
}

export async function fetchWithProxy(url: string): Promise<Response> {
  if (!shouldPersistResponse(url)) {
    return fetch(proxyUrl(url));
  }

  const cacheKey = buildResponseCacheKey(url);
  const cached = await getPersistentCache<CachedResponsePayload>(cacheKey);

  if (cached?.data) {
    void fetchAndPersist(url).catch((error) => {
      console.warn('[proxy] Background refresh failed for cached API response', error);
    });
    return toResponse(cached.data);
  }

  return fetchAndPersist(url);
}
