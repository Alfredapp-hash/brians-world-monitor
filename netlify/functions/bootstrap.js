import handler from '../../api/bootstrap.js';
import { invokeEdgeHandler } from './_shared/invoke-edge-handler.js';

export default async (req, context) => invokeEdgeHandler(handler, req, context);

export const config = {
  path: '/api/bootstrap',
};
