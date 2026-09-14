/**
 * Same-origin API for The Public Dispatch on Netlify.
 * Does not proxy to brians-world-monitor.vercel.app / worldmonitor.app.
 */
import { dispatchNetlifyApi } from '../../server/netlify-dispatch';

export default async (req: Request): Promise<Response> => {
  return dispatchNetlifyApi(req);
};

export const config = {
  path: [
    '/api/*',
    '/mcp',
    '/a2a',
    '/ask',
    '/oauth/*',
    '/agent/auth',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
    '/.well-known/mcp',
    '/.well-known/mcp.json',
  ],
};
