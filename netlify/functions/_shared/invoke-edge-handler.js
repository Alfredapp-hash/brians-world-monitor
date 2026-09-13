/**
 * Adapt a Vercel Edge-style (req, ctx) handler to a Netlify Function.
 * Existing api/*.js handlers already speak Web Request/Response.
 */
export function invokeEdgeHandler(handler, req, context) {
  const ctx = {
    waitUntil(promise) {
      if (typeof context?.waitUntil === 'function') {
        context.waitUntil(promise);
      }
    },
  };
  return handler(req, ctx);
}
