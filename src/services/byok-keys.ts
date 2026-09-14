/**
 * Bring-your-own-key storage for AI providers (web runtime).
 *
 * Desktop already has a real secret vault (`runtime-config.ts` ->
 * `setSecretValue`, Tauri-side storage). The browser has no equivalent, so
 * this module is the web counterpart with the same shape: validate, stage,
 * persist, mask, clear.
 *
 * Security posture — stated plainly because users deserve to know:
 *
 *   - Keys live in this browser's localStorage only. They are NEVER sent to
 *     a WorldMonitor server, never attached to an RPC, and never written to
 *     console/Sentry. The only outbound destination is the provider's own
 *     API, called directly from the page.
 *   - At rest the value is obfuscated (XOR + base64), not encrypted. Nothing
 *     running in this origin can be hidden from itself, so claiming
 *     encryption would be a lie. Obfuscation only stops casual shoulder-
 *     surfing of DevTools and accidental capture in a screen share.
 *   - `maskKey()` is the only representation any UI or log line may show.
 *
 * Storage is injected so the module is loadable under `tsx --test` with no
 * browser globals.
 */

// Relative (not `@/`) so this module and its unit test load under
// `tsx --test` without tsconfig path resolution.
import { BYOK_PROVIDERS, getByokProvider, type ByokProviderId } from '../config/support';

const STORAGE_PREFIX = 'wm-byok-';
/** Fixed pad. Not a secret and not pretending to be one — see header. */
const OBFUSCATION_PAD = 'worldmonitor-byok-v1';

export interface KeyValidation {
  valid: boolean;
  /** Human-readable reason, safe to render. Never contains the key. */
  hint?: string;
}

export interface StoredKeyState {
  provider: ByokProviderId;
  present: boolean;
  /** e.g. "gsk_...9f2c" — safe to render. */
  masked: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let storage: StorageLike | null | undefined;

function getStorage(): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    // Private browsing / blocked storage: BYOK degrades to "not available".
    storage = null;
  }
  return storage;
}

/** Test seam. Pass null to simulate unavailable storage. */
export function __setByokStorageForTests(next: StorageLike | null): void {
  storage = next;
}

function storageKey(provider: ByokProviderId): string {
  return `${STORAGE_PREFIX}${provider}`;
}

function obfuscate(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(
      raw.charCodeAt(i) ^ OBFUSCATION_PAD.charCodeAt(i % OBFUSCATION_PAD.length),
    );
  }
  // btoa is latin1-only; the XOR output stays in the 0-255 range for the
  // ASCII keys every supported provider issues.
  return btoa(out);
}

function deobfuscate(stored: string): string | null {
  let decoded: string;
  try {
    decoded = atob(stored);
  } catch {
    return null;
  }
  let out = '';
  for (let i = 0; i < decoded.length; i++) {
    out += String.fromCharCode(
      decoded.charCodeAt(i) ^ OBFUSCATION_PAD.charCodeAt(i % OBFUSCATION_PAD.length),
    );
  }
  return out;
}

/**
 * Format-check a pasted key. Deliberately shallow: a prefix and length check
 * catches the common mistakes (empty paste, whole curl command, wrong
 * provider's key) without pretending to know the provider's key grammar.
 * Real verification is a live call — see `verifyByokKey`.
 */
export function validateByokKey(provider: ByokProviderId, raw: string): KeyValidation {
  const def = getByokProvider(provider);
  if (!def) return { valid: false, hint: 'Unknown provider.' };

  const value = raw.trim();
  if (!value) return { valid: false, hint: 'Paste a key first.' };
  if (/\s/.test(value)) {
    return { valid: false, hint: 'That looks like more than a key — paste only the key itself.' };
  }
  if (!value.startsWith(def.keyPrefix)) {
    return { valid: false, hint: `${def.label} keys start with ${def.keyPrefix}` };
  }
  if (value.length < def.minLength) {
    return { valid: false, hint: 'That key looks too short to be complete.' };
  }
  return { valid: true };
}

/** "gsk_...9f2c". Never returns enough to reconstruct the key. */
export function maskByokKey(raw: string): string {
  const value = raw.trim();
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Persist a key after validation. Returns the validation result; on failure
 * nothing is written. The raw value is never logged by this function.
 */
export function saveByokKey(provider: ByokProviderId, raw: string): KeyValidation {
  const result = validateByokKey(provider, raw);
  if (!result.valid) return result;

  const store = getStorage();
  if (!store) {
    return { valid: false, hint: 'This browser is blocking local storage, so the key cannot be saved.' };
  }
  try {
    store.setItem(storageKey(provider), obfuscate(raw.trim()));
  } catch {
    return { valid: false, hint: 'Could not save the key — local storage is full or unavailable.' };
  }
  return { valid: true };
}

export function getByokKey(provider: ByokProviderId): string | null {
  const store = getStorage();
  if (!store) return null;
  let stored: string | null;
  try {
    stored = store.getItem(storageKey(provider));
  } catch {
    return null;
  }
  if (!stored) return null;
  const raw = deobfuscate(stored);
  if (!raw) return null;
  // A key that no longer passes the format check is corrupt storage, not a
  // usable credential. Treat it as absent rather than sending garbage to a
  // provider.
  return validateByokKey(provider, raw).valid ? raw : null;
}

export function clearByokKey(provider: ByokProviderId): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.removeItem(storageKey(provider));
  } catch {
    // Nothing actionable; the getter fails closed.
  }
}

export function getByokKeyStates(): StoredKeyState[] {
  return BYOK_PROVIDERS.map((def) => {
    const key = getByokKey(def.id);
    return {
      provider: def.id,
      present: key !== null,
      masked: key ? maskByokKey(key) : '',
    };
  });
}

/** True when at least one provider key is stored — the "unlimited briefs" signal. */
export function hasAnyByokKey(): boolean {
  return BYOK_PROVIDERS.some((def) => getByokKey(def.id) !== null);
}

export interface VerifyResult {
  ok: boolean;
  /** Safe to render; never contains the key. */
  message: string;
}

/**
 * Live-verify a key against the provider's own API.
 *
 * The request goes straight from the browser to the provider — it does not
 * traverse our edge functions, so the key stays off our infrastructure. A
 * network/CORS failure is reported as "couldn't reach", NOT as invalid: the
 * user should not be told their key is bad because a corporate proxy blocked
 * the request.
 */
export async function verifyByokKey(
  provider: ByokProviderId,
  raw: string,
): Promise<VerifyResult> {
  const def = getByokProvider(provider);
  if (!def) return { ok: false, message: 'Unknown provider.' };

  const format = validateByokKey(provider, raw);
  if (!format.valid) return { ok: false, message: format.hint ?? 'That key is not valid.' };

  try {
    const resp = await globalThis.fetch(def.verifyUrl, {
      headers: { Authorization: `Bearer ${raw.trim()}` },
    });
    if (resp.ok) return { ok: true, message: `${def.label} accepted this key.` };
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, message: `${def.label} rejected this key.` };
    }
    if (resp.status === 429) {
      return { ok: true, message: `${def.label} recognised the key but is rate-limiting right now.` };
    }
    return { ok: false, message: `${def.label} returned an unexpected ${resp.status}.` };
  } catch {
    return {
      ok: false,
      message: `Couldn\u2019t reach ${def.label} to check the key. It is saved — try again later.`,
    };
  }
}
