/**
 * Premium RPC paths that require either an API key or a Pro session.
 *
 * Single source of truth consumed by both the server gateway (auth enforcement)
 * and the web client runtime (token injection).
 */
export const PREMIUM_RPC_PATHS = new Set<string>([
  '/api/market/v1/analyze-stock',
  '/api/market/v1/get-stock-analysis-history',
  '/api/market/v1/backtest-stock',
  '/api/market/v1/list-stored-stock-backtests',
  // LLM-backed or mutation surfaces. Redis-read intelligence (regional
  // snapshots, resilience, sanctions, trade, supply-chain, tenders, debt)
  // is public on this self-hosted fork — no LLM spend, no operator action.
  '/api/intelligence/v1/classify-event',
  '/api/intelligence/v1/deduct-situation',
  '/api/intelligence/v1/list-market-implications',
  '/api/scenario/v1/run-scenario',
  '/api/scenario/v1/get-scenario-status',
  '/api/forecast/v1/trigger-simulation',
  '/api/v2/shipping/webhooks',
  '/api/mcp-proxy',
  '/api/chat-analyst',
]);
