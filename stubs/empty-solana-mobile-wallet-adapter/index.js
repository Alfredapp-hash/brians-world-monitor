export const SolanaMobileWalletAdapterWalletName = 'Solana Mobile Wallet Adapter';

export function createDefaultAddressSelector() {
  return () => undefined;
}

export function createDefaultAuthorizationResultCache() {
  return {
    get() {
      return Promise.resolve(undefined);
    },
    set() {
      return Promise.resolve();
    },
    clear() {
      return Promise.resolve();
    },
  };
}

export function createDefaultWalletNotFoundHandler() {
  return () => {};
}

export class SolanaMobileWalletAdapter {
  constructor() {
    throw new Error('Solana mobile wallet sign-in is not available in this app');
  }
}
