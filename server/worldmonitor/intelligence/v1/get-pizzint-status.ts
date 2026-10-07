import type {
  ServerContext,
  GetPizzintStatusRequest,
  GetPizzintStatusResponse,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { PIZZINT_SEED_KEY, pizzintReadKeys } from '../../../../shared/pizzint-seed-keys.js';

export { PIZZINT_SEED_KEY };

export async function getPizzintStatus(
  _ctx: ServerContext,
  req: GetPizzintStatusRequest,
): Promise<GetPizzintStatusResponse> {
  try {
    let result: GetPizzintStatusResponse | null = null;
    for (const key of pizzintReadKeys(Boolean(req.includeGdelt))) {
      const cached = await getCachedJson(key, true) as GetPizzintStatusResponse | null;
      if (cached?.pizzint) {
        result = cached;
        break;
      }
    }
    if (!result?.pizzint) return { pizzint: undefined, tensionPairs: [] };
    return req.includeGdelt ? result : { pizzint: result.pizzint, tensionPairs: [] };
  } catch {
    return { pizzint: undefined, tensionPairs: [] };
  }
}
