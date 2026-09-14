/**
 * Dispatch same-origin /api on Netlify without proxying to Vercel.
 *
 * Sebuf `/api/{domain}/vN/*` goes through createDomainGateway (CORS, keys,
 * rate-limit). Flat `api/*.js` / a few TS entrypoints keep their own handlers.
 */
import { createSebufGateway } from './sebuf-all-routes';
import { isSebufApiPath, resolveDispatchPath } from './sebuf-paths';

export { isSebufApiPath, resolveDispatchPath } from './sebuf-paths';

type EdgeHandler = {
  default: (req: Request, ctx?: unknown) => Promise<Response> | Response;
};

function flatLoader(load: () => Promise<unknown>): () => Promise<EdgeHandler> {
  return () => load() as Promise<EdgeHandler>;
}

const FLAT_LOADERS: Record<string, () => Promise<EdgeHandler>> = {
  '/api/a2a': flatLoader(() => import('../api/a2a.ts')),
  '/api/agent-auth': flatLoader(() => import('../api/agent-auth.ts')),
  '/api/ask': flatLoader(() => import('../api/ask.ts')),
  // @ts-expect-error untyped api JS
  '/api/bootstrap': flatLoader(() => import('../api/bootstrap.js')),
  // @ts-expect-error untyped api JS
  '/api/cache-purge': flatLoader(() => import('../api/cache-purge.js')),
  '/api/chat-analyst': flatLoader(() => import('../api/chat-analyst.ts')),
  '/api/create-checkout': flatLoader(() => import('../api/create-checkout.ts')),
  '/api/customer-portal': flatLoader(() => import('../api/customer-portal.ts')),
  // @ts-expect-error untyped api JS
  '/api/download': flatLoader(() => import('../api/download.js')),
  // @ts-expect-error untyped api JS
  '/api/fwdstart': flatLoader(() => import('../api/fwdstart.js')),
  // @ts-expect-error untyped api JS
  '/api/geo': flatLoader(() => import('../api/geo.js')),
  // @ts-expect-error untyped api JS
  '/api/gpsjam': flatLoader(() => import('../api/gpsjam.js')),
  // @ts-expect-error untyped api JS
  '/api/health': flatLoader(() => import('../api/health.js')),
  '/api/http-message-signatures-directory': flatLoader(() => import('../api/http-message-signatures-directory.ts')),
  '/api/latest-brief': flatLoader(() => import('../api/latest-brief.ts')),
  '/api/mcp': flatLoader(() => import('../api/mcp.ts')),
  '/api/mcp-proxy': flatLoader(() => import('../api/mcp-proxy.ts')),
  '/api/me/entitlement': flatLoader(() => import('../api/me/entitlement.ts')),
  '/api/notify': flatLoader(() => import('../api/notify.ts')),
  '/api/notification-channels': flatLoader(() => import('../api/notification-channels.ts')),
  '/api/oauth-authorization-server': flatLoader(() => import('../api/oauth-authorization-server.ts')),
  '/api/oauth-protected-resource': flatLoader(() => import('../api/oauth-protected-resource.ts')),
  // @ts-expect-error untyped api JS
  '/api/oauth/authorize': flatLoader(() => import('../api/oauth/authorize.js')),
  '/api/oauth/authorize-pro': flatLoader(() => import('../api/oauth/authorize-pro.ts')),
  // @ts-expect-error untyped api JS
  '/api/oauth/register': flatLoader(() => import('../api/oauth/register.js')),
  '/api/oauth/token': flatLoader(() => import('../api/oauth/token.ts')),
  // @ts-expect-error untyped api JS
  '/api/og-story': flatLoader(() => import('../api/og-story.js')),
  // @ts-expect-error untyped api JS
  '/api/opensky': flatLoader(() => import('../api/opensky.js')),
  // @ts-expect-error untyped api JS
  '/api/oref-alerts': flatLoader(() => import('../api/oref-alerts.js')),
  // @ts-expect-error untyped api JS
  '/api/polymarket': flatLoader(() => import('../api/polymarket.js')),
  // @ts-expect-error untyped api JS
  '/api/product-catalog': flatLoader(() => import('../api/product-catalog.js')),
  // @ts-expect-error untyped api JS
  '/api/reverse-geocode': flatLoader(() => import('../api/reverse-geocode.js')),
  // @ts-expect-error untyped api JS
  '/api/rss-proxy': flatLoader(() => import('../api/rss-proxy.js')),
  // @ts-expect-error untyped api JS
  '/api/security/report': flatLoader(() => import('../api/security/report.js')),
  // @ts-expect-error untyped api JS
  '/api/story': flatLoader(() => import('../api/story.js')),
  // @ts-expect-error untyped api JS
  '/api/supply-chain/hormuz-tracker': flatLoader(() => import('../api/supply-chain/hormuz-tracker.js')),
  '/api/symbol-search': flatLoader(() => import('../api/symbol-search.ts')),
  // @ts-expect-error untyped api JS
  '/api/telegram-feed': flatLoader(() => import('../api/telegram-feed.js')),
  '/api/user-prefs': flatLoader(() => import('../api/user-prefs.ts')),
  // @ts-expect-error untyped api JS
  '/api/version': flatLoader(() => import('../api/version.js')),
  '/api/widget-agent': flatLoader(() => import('../api/widget-agent.ts')),
  // @ts-expect-error untyped api JS
  '/api/wm-session': flatLoader(() => import('../api/wm-session.js')),
  // @ts-expect-error untyped api JS
  '/api/youtube/embed': flatLoader(() => import('../api/youtube/embed.js')),
  // @ts-expect-error untyped api JS
  '/api/youtube/live': flatLoader(() => import('../api/youtube/live.js')),
  '/mcp': flatLoader(() => import('../api/mcp.ts')),
  '/a2a': flatLoader(() => import('../api/a2a.ts')),
  '/ask': flatLoader(() => import('../api/ask.ts')),
  // @ts-expect-error untyped api JS
  '/oauth/authorize': flatLoader(() => import('../api/oauth/authorize.js')),
  '/oauth/authorize-pro': flatLoader(() => import('../api/oauth/authorize-pro.ts')),
  // @ts-expect-error untyped api JS
  '/oauth/register': flatLoader(() => import('../api/oauth/register.js')),
  '/oauth/token': flatLoader(() => import('../api/oauth/token.ts')),
  '/agent/auth': flatLoader(() => import('../api/agent-auth.ts')),
  '/.well-known/oauth-protected-resource': flatLoader(() => import('../api/oauth-protected-resource.ts')),
  '/.well-known/oauth-authorization-server': flatLoader(() => import('../api/oauth-authorization-server.ts')),
  '/.well-known/mcp': flatLoader(() => import('../api/mcp.ts')),
  '/.well-known/mcp.json': flatLoader(() => import('../api/mcp.ts')),
};

function rewriteRequestPath(req: Request, pathname: string): Request {
  const url = new URL(req.url);
  if (url.pathname === pathname) return req;
  url.pathname = pathname;
  return new Request(url, req);
}

let sebufGateway: ((req: Request) => Promise<Response>) | null = null;

function getSebufGateway(): (req: Request) => Promise<Response> {
  if (!sebufGateway) sebufGateway = createSebufGateway();
  return sebufGateway;
}

export async function dispatchNetlifyApi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = resolveDispatchPath(url.pathname);
  const routed = rewriteRequestPath(req, pathname);

  if (isSebufApiPath(pathname)) {
    return getSebufGateway()(routed);
  }

  const load = FLAT_LOADERS[pathname];
  if (load) {
    const mod = await load();
    return mod.default(routed);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

export const NETLIFY_FLAT_API_PATHS = Object.keys(FLAT_LOADERS);
