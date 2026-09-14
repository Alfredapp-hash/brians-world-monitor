import handler from '../../api/news/v1/[rpc].ts';
import { invokeEdgeHandler } from '../lib/invoke-edge-handler.js';

export default async (req, context) => invokeEdgeHandler(handler, req, context);

export const config = {
  path: '/api/news/v1/list-feed-digest',
};
