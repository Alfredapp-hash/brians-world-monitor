import handler from '../../api/displacement/v1/[rpc].ts';
import { invokeEdgeHandler } from '../lib/invoke-edge-handler.js';

export default async (req, context) => invokeEdgeHandler(handler, req, context);

export const config = {
  path: '/api/displacement/v1/get-displacement-summary',
};
