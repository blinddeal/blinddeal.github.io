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
  on?(event: string, handler: (value?: unknown) => void): void;
  off?(event: string, handler: (value?: unknown) => void): void;
  removeListener?(event: string, handler: (value?: unknown) => void): void;
};

export type InstalledWallet = {
  name: string;
  provider: SolanaProvider;
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

function asPublicKey(value: PublicKey | { toBytes(): Uint8Array; toString(): string } | string): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") return new PublicKey(value);
  try {
    return new PublicKey(value.toBytes());
  } catch {
    return new PublicKey(value.toString());
  }
}

function record(list: InstalledWallet[], name: string, provider?: SolanaProvider) {
  if (!provider?.connect || !provider.signTransaction) return;
  if (list.some((item) => item.provider === provider)) return;
  list.push({ name, provider });
}

export function installedWallets(): InstalledWallet[] {
  if (typeof window === "undefined") return [];
  const host = window as WalletWindow;
  const list: InstalledWallet[] = [];
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

export function shortKey(key: PublicKey | string): string {
  const text = typeof key === "string" ? key : key.toBase58();
  return text.slice(0, 4) + "…" + text.slice(-4);
}
