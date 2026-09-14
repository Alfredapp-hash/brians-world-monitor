import handler from '../../api/bootstrap.js';
import { invokeEdgeHandler } from '../lib/invoke-edge-handler.js';

export default async (req, context) => invokeEdgeHandler(handler, req, context);

export const config = {
  path: '/api/bootstrap',
};
