/**
 * Composition layer between the pure briefing-allowance bookkeeping and the
 * live app state (billing + locally stored provider keys).
 *
 * Kept separate so `briefing-allowance.ts` stays import-light and unit
 * testable, while components get a one-call answer.
 */

import { hasAnyByokKey } from './byok-keys';
import { isSupporter } from './supporter-status';
import {
  consumeBriefingRun,
  getBriefingAllowance,
  type BriefingAllowance,
  type BriefingContext,
} from './briefing-allowance';

export function currentBriefingContext(): BriefingContext {
  return { supporter: isSupporter(), ownKey: hasAnyByokKey() };
}

export function currentBriefingAllowance(): BriefingAllowance {
  return getBriefingAllowance(currentBriefingContext());
}

/** Record a successful hosted brief generation against today's allowance. */
export function noteBriefGenerated(): BriefingAllowance {
  return consumeBriefingRun(currentBriefingContext());
}
