// Tests for src/services/byok-keys.ts
//
// Every key in this file is obviously synthetic — built from the provider
// prefix plus repeated padding characters. Never paste a real credential here.
//
// What these tests protect:
//   - a saved key round-trips exactly (a mangled key is a support ticket)
//   - the value at rest is not plaintext (DevTools / screen-share exposure)
//   - bad input is rejected WITHOUT writing anything
//   - corrupt or unavailable storage fails closed, never throws
//   - verification talks to the provider's own host, never to ours

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { BYOK_PROVIDERS, getByokProvider } from '../src/config/support.ts';
import {
  __setByokStorageForTests,
  clearByokKey,
  getByokKey,
  getByokKeyStates,
  hasAnyByokKey,
  maskByokKey,
  saveByokKey,
  validateByokKey,
  verifyByokKey,
} from '../src/services/byok-keys.ts';

// Synthetic keys: prefix + filler. Shaped like the real thing, worth nothing.
const GROQ_KEY = `gsk_${'x'.repeat(40)}`;
const OPENROUTER_KEY = `sk-or-${'y'.repeat(40)}`;

interface FakeStorage {
  map: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function makeFakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

let store: FakeStorage;

describe('byok keys', () => {
  beforeEach(() => {
    store = makeFakeStorage();
    __setByokStorageForTests(store);
  });

  describe('round-trip', () => {
    it('saves and reads back the exact key', () => {
      assert.deepEqual(saveByokKey('groq', GROQ_KEY), { valid: true });
      assert.equal(getByokKey('groq'), GROQ_KEY);
    });

    it('keeps providers independent', () => {
      saveByokKey('groq', GROQ_KEY);
      saveByokKey('openrouter', OPENROUTER_KEY);
      assert.equal(getByokKey('groq'), GROQ_KEY);
      assert.equal(getByokKey('openrouter'), OPENROUTER_KEY);
    });

    it('trims surrounding whitespace from a pasted key', () => {
      assert.equal(saveByokKey('groq', `  ${GROQ_KEY}\n`).valid, true);
      assert.equal(getByokKey('groq'), GROQ_KEY);
    });

    it('returns null for a provider that was never saved', () => {
      assert.equal(getByokKey('openrouter'), null);
    });
  });

  describe('persistence is obfuscated at rest', () => {
    it('never writes the raw key verbatim', () => {
      saveByokKey('groq', GROQ_KEY);
      const written = [...store.map.values()];
      assert.ok(written.length > 0, 'something must have been written');
      for (const value of written) {
        assert.ok(
          !value.includes(GROQ_KEY),
          'the plaintext key must not be visible in localStorage',
        );
      }
    });

    it('does not leak the key\u2019s distinctive prefix as a stored substring', () => {
      saveByokKey('openrouter', OPENROUTER_KEY);
      for (const value of store.map.values()) {
        assert.ok(!value.includes(OPENROUTER_KEY));
        assert.ok(!value.includes(OPENROUTER_KEY.slice(0, 20)));
      }
    });

    it('uses the wm-byok-<provider> storage key convention', () => {
      saveByokKey('groq', GROQ_KEY);
      assert.ok(store.map.has('wm-byok-groq'), [...store.map.keys()].join(','));
    });
  });

  describe('validation rejects bad input without writing', () => {
    const rejected: Array<[string, string]> = [
      ['empty string', ''],
      ['whitespace only', '   \n\t '],
      ['a pasted curl command', `curl -H "Authorization: Bearer ${GROQ_KEY}"`],
      ['an internal space', `gsk_${'x'.repeat(20)} ${'x'.repeat(20)}`],
      ['the wrong provider\u2019s key', OPENROUTER_KEY],
      ['a too-short key', 'gsk_short'],
    ];

    for (const [label, value] of rejected) {
      it(`rejects ${label}`, () => {
        const validation = validateByokKey('groq', value);
        assert.equal(validation.valid, false);
        assert.equal(typeof validation.hint, 'string');
        assert.ok((validation.hint ?? '').length > 0, 'a rejection must explain itself');

        const saved = saveByokKey('groq', value);
        assert.equal(saved.valid, false);
        assert.ok((saved.hint ?? '').length > 0);
        assert.equal(store.map.size, 0, 'a rejected key must not be persisted');
        assert.equal(getByokKey('groq'), null);
      });
    }

    it('never echoes the submitted value back in the hint', () => {
      const hint = saveByokKey('groq', OPENROUTER_KEY).hint ?? '';
      assert.ok(!hint.includes(OPENROUTER_KEY));
    });

    it('accepts a well-formed key for each configured provider', () => {
      for (const def of BYOK_PROVIDERS) {
        const key = `${def.keyPrefix}${'z'.repeat(def.minLength + 10)}`;
        assert.equal(validateByokKey(def.id, key).valid, true, def.id);
      }
    });
  });

  describe('clearing and presence', () => {
    it('hasAnyByokKey flips false -> true -> false', () => {
      assert.equal(hasAnyByokKey(), false);
      saveByokKey('groq', GROQ_KEY);
      assert.equal(hasAnyByokKey(), true);
      clearByokKey('groq');
      assert.equal(getByokKey('groq'), null);
      assert.equal(hasAnyByokKey(), false);
    });

    it('stays true while any other provider key remains', () => {
      saveByokKey('groq', GROQ_KEY);
      saveByokKey('openrouter', OPENROUTER_KEY);
      clearByokKey('groq');
      assert.equal(hasAnyByokKey(), true);
      clearByokKey('openrouter');
      assert.equal(hasAnyByokKey(), false);
    });

    it('clearing an absent key is a no-op', () => {
      assert.doesNotThrow(() => clearByokKey('openrouter'));
      assert.equal(hasAnyByokKey(), false);
    });
  });

  describe('getByokKeyStates', () => {
    it('reports presence per provider', () => {
      saveByokKey('groq', GROQ_KEY);
      const states = getByokKeyStates();
      assert.equal(states.length, BYOK_PROVIDERS.length);

      const groq = states.find((s) => s.provider === 'groq');
      const openrouter = states.find((s) => s.provider === 'openrouter');
      assert.equal(groq?.present, true);
      assert.equal(openrouter?.present, false);
      assert.equal(openrouter?.masked, '');
    });

    it('masked never contains the middle of the key', () => {
      saveByokKey('groq', GROQ_KEY);
      const masked = getByokKeyStates().find((s) => s.provider === 'groq')?.masked ?? '';
      assert.ok(masked.length > 0);
      assert.ok(masked.length <= 16, `masked value should be short, got ${masked.length}`);
      assert.ok(!masked.includes(GROQ_KEY), 'masked must not contain the full key');
      assert.ok(
        !masked.includes(GROQ_KEY.slice(8, 24)),
        'masked must not contain the interior of the key',
      );
    });
  });

  describe('maskByokKey', () => {
    it('never returns the full key', () => {
      const masked = maskByokKey(GROQ_KEY);
      assert.ok(!masked.includes(GROQ_KEY));
      assert.ok(masked.length < GROQ_KEY.length);
      assert.ok(masked.startsWith('gsk_'));
      assert.ok(masked.endsWith(GROQ_KEY.slice(-4)));
    });

    it('reveals nothing at all for a short input', () => {
      for (const short of ['', 'a', 'gsk_', 'gsk_abcd']) {
        const masked = maskByokKey(short);
        assert.equal(masked, '\u2022\u2022\u2022\u2022');
        if (short.length > 0) assert.ok(!masked.includes(short));
      }
    });

    it('ignores surrounding whitespace', () => {
      assert.equal(maskByokKey(`  ${GROQ_KEY}  `), maskByokKey(GROQ_KEY));
    });
  });

  describe('corrupt storage fails closed', () => {
    it('returns null for a value that is not base64', () => {
      store.map.set('wm-byok-groq', '!!!not-base64!!!');
      let result: string | null = 'unset';
      assert.doesNotThrow(() => {
        result = getByokKey('groq');
      });
      assert.equal(result, null);
      assert.equal(hasAnyByokKey(), false);
    });

    it('returns null for decodable bytes that are not a valid key', () => {
      // Valid base64, but the deobfuscated result fails the format check —
      // garbage must never be forwarded to a provider as a credential.
      store.map.set('wm-byok-groq', btoa('totally-not-a-key'));
      assert.equal(getByokKey('groq'), null);
      assert.equal(getByokKeyStates().find((s) => s.provider === 'groq')?.present, false);
    });

    it('returns null for an empty stored value', () => {
      store.map.set('wm-byok-groq', '');
      assert.equal(getByokKey('groq'), null);
    });
  });

  describe('storage unavailable', () => {
    beforeEach(() => {
      __setByokStorageForTests(null);
    });

    it('saveByokKey reports failure with a hint', () => {
      const result = saveByokKey('groq', GROQ_KEY);
      assert.equal(result.valid, false);
      assert.ok((result.hint ?? '').length > 0);
    });

    it('reads are null and nothing throws', () => {
      assert.doesNotThrow(() => {
        assert.equal(getByokKey('groq'), null);
        assert.equal(hasAnyByokKey(), false);
        clearByokKey('groq');
        assert.deepEqual(
          getByokKeyStates().map((s) => s.present),
          BYOK_PROVIDERS.map(() => false),
        );
      });
    });
  });

  describe('storage that throws', () => {
    it('degrades to unavailable rather than crashing the settings panel', () => {
      __setByokStorageForTests({
        getItem() {
          throw new Error('SecurityError');
        },
        setItem() {
          throw new Error('QuotaExceededError');
        },
        removeItem() {
          throw new Error('SecurityError');
        },
      });
      assert.equal(saveByokKey('groq', GROQ_KEY).valid, false);
      assert.equal(getByokKey('groq'), null);
      assert.equal(hasAnyByokKey(), false);
      assert.doesNotThrow(() => clearByokKey('groq'));
    });
  });
});

describe('verifyByokKey', () => {
  const realFetch = globalThis.fetch;
  let calls: Array<{ url: string; init: RequestInit | undefined }>;

  function stubFetch(handler: (url: string) => unknown): void {
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const outcome = handler(url);
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome);
    }) as unknown as typeof fetch;
  }

  function response(status: number): unknown {
    return { ok: status >= 200 && status < 300, status };
  }

  beforeEach(() => {
    calls = [];
    __setByokStorageForTests(makeFakeStorage());
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('accepts a 200', async () => {
    stubFetch(() => response(200));
    const result = await verifyByokKey('groq', GROQ_KEY);
    assert.equal(result.ok, true);
    assert.ok(result.message.length > 0);
  });

  it('treats 429 as a recognised key (rate limit is not rejection)', async () => {
    stubFetch(() => response(429));
    const result = await verifyByokKey('groq', GROQ_KEY);
    assert.equal(result.ok, true);
    assert.match(result.message, /rate/i);
  });

  it('reports a 401 as a rejection naming the provider', async () => {
    stubFetch(() => response(401));
    const result = await verifyByokKey('groq', GROQ_KEY);
    assert.equal(result.ok, false);
    assert.match(result.message, /groq/i);
    assert.ok(!result.message.includes(GROQ_KEY), 'the key must never appear in UI copy');
  });

  it('reports a 403 as a rejection too', async () => {
    stubFetch(() => response(403));
    assert.equal((await verifyByokKey('openrouter', OPENROUTER_KEY)).ok, false);
  });

  it('reports a network failure as unreachable, NOT as an invalid key', async () => {
    stubFetch(() => new TypeError('Failed to fetch'));
    const result = await verifyByokKey('groq', GROQ_KEY);
    assert.equal(result.ok, false);
    assert.match(result.message, /reach/i);
    assert.doesNotMatch(
      result.message,
      /rejected|invalid/i,
      'a blocked proxy must not be reported as a bad key',
    );
  });

  it('sends the key as an Authorization: Bearer header', async () => {
    stubFetch(() => response(200));
    await verifyByokKey('groq', GROQ_KEY);
    assert.equal(calls.length, 1);
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${GROQ_KEY}`);
  });

  it('sends the key only to the provider\u2019s own host', async () => {
    stubFetch(() => response(200));
    await verifyByokKey('groq', GROQ_KEY);
    await verifyByokKey('openrouter', OPENROUTER_KEY);

    const hosts = calls.map((c) => new URL(c.url).hostname);
    assert.deepEqual(hosts, ['api.groq.com', 'openrouter.ai']);
    for (const { url } of calls) {
      const { protocol, hostname } = new URL(url);
      assert.equal(protocol, 'https:');
      assert.ok(
        !/worldmonitor\.app$|vercel\.app$|railway\.app$/.test(hostname),
        `a user key must never be sent to our own infrastructure (${hostname})`,
      );
    }
  });

  it('uses the verifyUrl declared in config for each provider', async () => {
    stubFetch(() => response(200));
    await verifyByokKey('groq', GROQ_KEY);
    assert.equal(calls[0].url, getByokProvider('groq')?.verifyUrl);
  });

  it('does not call the network at all for a malformed key', async () => {
    stubFetch(() => response(200));
    const result = await verifyByokKey('groq', 'nope');
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0, 'a format failure must short-circuit before any request');
  });
});
