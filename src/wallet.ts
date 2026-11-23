import { PublicKey, Transaction } from "@solana/web3.js";
import type { DealWallet } from "blinddeal-sdk";

export type SolanaProvider = {
  publicKey?: PublicKey | { toBytes(): Uint8Array; toString(): string };
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isGlow?: boolean;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey | { toBytes(): Uint8Array; toString(): string } }>;
  disconnect?(): Promise<void>;
  signTransaction<T extends Transaction>(transaction: T): Promise<T>;
  signMessage?(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  on?(event: string, handler: (value?: unknown) => void): void;
  off?(event: string, handler: (value?: unknown) => void): void;
  removeListener?(event: string, handler: (value?: unknown) => void): void;
};

export type InstalledWallet = {
  name: string;
  provider: SolanaProvider;
  standard?: boolean;
};

type WalletWindow = Window & {
  solana?: SolanaProvider;
  phantom?: { solana?: SolanaProvider };
  solflare?: SolanaProvider;
  backpack?: SolanaProvider;
  glow?: { solana?: SolanaProvider };
  glowSolana?: SolanaProvider;
  okxwallet?: { solana?: SolanaProvider };
};

type StandardAccount = {
  address: string;
  publicKey: Uint8Array;
};

type StandardWallet = {
  name?: string;
  accounts?: StandardAccount[];
  features: Record<string, unknown>;
};

function asPublicKey(value: PublicKey | { toBytes(): Uint8Array; toString(): string } | string): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") return new PublicKey(value);
  try {
    return new PublicKey(value.toBytes());
  } catch {
    return new PublicKey(value.toString());
  }
}

export function asSignatureBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value && typeof value === "object" && "signature" in value) {
    return asSignatureBytes((value as { signature: unknown }).signature);
  }
  if (value && typeof value === "object" && "data" in value && Array.isArray((value as { data: unknown }).data)) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  throw new Error("The wallet did not return a signature.");
}

function record(list: InstalledWallet[], name: string, provider?: SolanaProvider, standard = false) {
  if (!provider?.connect || !provider.signTransaction) return;
  if (list.some((item) => item.provider === provider || item.name === name)) return;
  list.push({ name, provider, standard });
}

function fromStandard(wallet: StandardWallet): InstalledWallet | null {
  const connectFeature = wallet.features["standard:connect"] as { connect?: () => Promise<{ accounts?: StandardAccount[] }> } | undefined;
  const signTx = wallet.features["solana:signTransaction"] as
    | { signTransaction?: (input: { account: StandardAccount; transaction: Uint8Array }) => Promise<{ signedTransaction: Uint8Array }[]> }
    | undefined;
  const signMsg = wallet.features["solana:signMessage"] as
    | { signMessage?: (input: { account: StandardAccount; message: Uint8Array }) => Promise<{ signature: Uint8Array }[]> }
    | undefined;
  const disconnectFeature = wallet.features["standard:disconnect"] as { disconnect?: () => Promise<void> } | undefined;
  if (!connectFeature?.connect || !signTx?.signTransaction) return null;
  const name = wallet.name?.trim() || "Solana wallet";
  let account: StandardAccount | undefined = wallet.accounts?.[0];
  const provider: SolanaProvider = {
    get publicKey() {
      return account ? new PublicKey(account.publicKey) : undefined;
    },
    async connect() {
      const result = await connectFeature.connect?.();
      const next = result?.accounts?.[0] ?? wallet.accounts?.[0];
      if (!next) throw new Error("The wallet did not return an address.");
      account = next;
      return { publicKey: new PublicKey(next.publicKey) };
    },
    async disconnect() {
      await disconnectFeature?.disconnect?.();
      account = undefined;
    },
    async signTransaction(transaction) {
      const current = account ?? wallet.accounts?.[0];
      if (!current) throw new Error("The wallet is not connected.");
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const signed = await signTx.signTransaction?.({ account: current, transaction: Uint8Array.from(serialized) });
      const bytes = signed?.[0]?.signedTransaction;
      if (!bytes) throw new Error("The wallet did not return a signed transaction.");
      return Transaction.from(bytes) as typeof transaction;
    },
    async signMessage(message) {
      if (!signMsg?.signMessage) throw new Error("This wallet cannot sign a message.");
      const current = account ?? wallet.accounts?.[0];
      if (!current) throw new Error("The wallet is not connected.");
      const signed = await signMsg.signMessage({ account: current, message });
      return signed?.[0]?.signature ?? Uint8Array.from([]);
    },
  };
  return { name, provider, standard: true };
}

function standardWallets(): InstalledWallet[] {
  if (typeof window === "undefined") return [];
  const list: InstalledWallet[] = [];
  const register = (wallet: StandardWallet) => {
    const item = fromStandard(wallet);
    if (item) record(list, item.name, item.provider, true);
  };
  const onRegister = (event: Event) => {
    const detail = (event as CustomEvent<{ register?: (wallet: (item: StandardWallet) => void) => void }>).detail;
    detail?.register?.(register);
  };
  window.addEventListener("wallet-standard:register-wallet", onRegister as EventListener);
  window.dispatchEvent(
    new CustomEvent("wallet-standard:app-ready", {
      detail: { apiVersion: 1, register },
    }),
  );
  window.removeEventListener("wallet-standard:register-wallet", onRegister as EventListener);
  return list;
}

export function installedWallets(): InstalledWallet[] {
  if (typeof window === "undefined") return [];
  const host = window as WalletWindow;
  const list: InstalledWallet[] = standardWallets();
  record(list, "Phantom", host.phantom?.solana ?? (host.solana?.isPhantom ? host.solana : undefined));
  record(list, "Solflare", host.solflare);
  record(list, "Backpack", host.backpack);
  record(list, "Glow", host.glow?.solana ?? host.glowSolana);
  record(list, "OKX", host.okxwallet?.solana);
  if (host.solana) record(list, host.solana.isPhantom ? "Phantom" : "Solana wallet", host.solana);
  return list;
}

export function toDealWallet(provider: SolanaProvider, publicKey: PublicKey): DealWallet {
  return {
    publicKey,
    async signTransaction(transaction) {
      return provider.signTransaction(transaction);
    },
  };
}

export function listenProvider(
  provider: SolanaProvider,
  handlers: { onConnect?: (key: PublicKey) => void; onDisconnect?: () => void; onAccount?: (key: PublicKey | null) => void },
) {
  const connect = (value?: unknown) => {
    try {
      if (value && typeof value === "object" && "publicKey" in value && value.publicKey) {
        handlers.onConnect?.(asPublicKey(value.publicKey as PublicKey | { toBytes(): Uint8Array; toString(): string }));
        return;
      }
      if (provider.publicKey) handlers.onConnect?.(asPublicKey(provider.publicKey));
    } catch {
      handlers.onDisconnect?.();
    }
  };
  const disconnect = () => handlers.onDisconnect?.();
  const account = (value?: unknown) => {
    if (!value) {
      handlers.onAccount?.(null);
      return;
    }
    try {
      handlers.onAccount?.(asPublicKey(value as PublicKey | { toBytes(): Uint8Array; toString(): string }));
    } catch {
      handlers.onAccount?.(null);
    }
  };
  provider.on?.("connect", connect);
  provider.on?.("disconnect", disconnect);
  provider.on?.("accountChanged", account);
  return () => {
    provider.off?.("connect", connect);
    provider.off?.("disconnect", disconnect);
    provider.off?.("accountChanged", account);
    provider.removeListener?.("connect", connect);
    provider.removeListener?.("disconnect", disconnect);
    provider.removeListener?.("accountChanged", account);
  };
}

export async function connectProvider(provider: SolanaProvider, onlyIfTrusted = false): Promise<PublicKey> {
  const result = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
  const key = result?.publicKey ?? provider.publicKey;
  if (!key) throw new Error("The wallet did not return an address.");
  return asPublicKey(key);
}

export async function signMessageBytes(provider: SolanaProvider, message: Uint8Array): Promise<Uint8Array> {
  if (!provider.signMessage) throw new Error("This wallet cannot sign a message.");
  return asSignatureBytes(await provider.signMessage(message, "utf8"));
}

export function canSignMessage(provider: SolanaProvider): boolean {
  return typeof provider.signMessage === "function";
}

export function shortKey(key: PublicKey | string): string {
  const text = typeof key === "string" ? key : key.toBase58();
  return text.slice(0, 4) + "…" + text.slice(-4);
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function needsWalletBrowse(): boolean {
  return isMobileDevice() && installedWallets().length === 0;
}

export function walletBrowseLinks(url = typeof location === "undefined" ? "https://blinddeal.github.io" : location.href): {
  name: string;
  href: string;
}[] {
  const encoded = encodeURIComponent(url);
  const ref = encodeURIComponent(new URL(url).origin);
  return [
    { name: "Phantom", href: "https://phantom.app/ul/browse/" + encoded + "?ref=" + ref },
    { name: "Solflare", href: "https://solflare.com/ul/v1/browse/" + encoded + "?ref=" + ref },
  ];
}
