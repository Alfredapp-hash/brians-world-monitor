import handler from '../../api/unrest/v1/[rpc].ts';
import { invokeEdgeHandler } from '../lib/invoke-edge-handler.js';

export default async (req, context) => invokeEdgeHandler(handler, req, context);

export const config = {
  path: '/api/unrest/v1/list-unrest-events',
};
