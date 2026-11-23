import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  associatedTokenAddress,
  cancelBuyer,
  cancelSeller,
  closeDeal,
  commitment,
  createDealInstruction,
  dealAddress,
  decodeReveal,
  expiryFromNow,
  fetchDeal,
  lockBuyerInstruction,
  lockSellerInstruction,
  randomSalt,
  refund,
  sendInstructions,
  settle,
  tokenAmount,
  type DealState,
  type DealWallet,
} from "blinddeal-sdk";
import {
  CONFIG,
  DEVNET_USDC,
  FAUCET_URL,
  WRAPPED_SOL,
  appCluster,
  connection,
  explorerAddress,
  explorerTx,
  mintDecimals,
  programIsLive,
  solLamports,
  tokenLabel,
} from "../cluster";
import { explainError } from "../errors";
import { findDealById } from "../onchain";
import {
  dealShareUrl,
  downloadText,
  encodeOffer,
  inviteShareUrl,
  loadMyDeals,
  loadTheirReveal,
  offerParties,
  parseRoute,
  saltBackupText,
  saveTheirReveal,
  updateMyDeal,
  upsertMyDeal,
  writeRoute,
  bytesToHex,
  type Offer,
  type Route,
  type StoredDeal,
} from "../offer";
import { copySlip, loadSlip, offerSlipKey, saveSlip, storedSlipText, type DealRef } from "../session";
import {
  base64ToBytes,
  buildSiwsMessage,
  bytesToBase64,
  clearSiwsSession,
  loadSiwsSession,
  randomNonce,
  saveSiwsSession,
  siwsDomain,
  siwsUri,
  verifyEd25519,
} from "../siws";
import { currentShot } from "../shot";
import { wrapSolInstructions } from "../wrap";
import {
  canSignMessage,
  connectProvider,
  installedWallets,
  listenProvider,
  needsWalletBrowse,
  shortKey,
  signMessageBytes,
  toDealWallet,
  walletBrowseLinks,
  type InstalledWallet,
  type SolanaProvider,
} from "../wallet";
import { Mascot, type Mood } from "./Mascot";
import { QrCode } from "./QrCode";
import { Window } from "./Window";

const EXPIRY_OPTIONS = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 60 * 60 * 24 },
  { label: "7 days", seconds: 60 * 60 * 24 * 7 },
  { label: "14 days", seconds: 60 * 60 * 24 * 14 },
  { label: "30 days", seconds: 60 * 60 * 24 * 30 },
];

type Session = {
  name: string;
  provider: SolanaProvider;
  publicKey: PublicKey;
  wallet: DealWallet;
  signed: boolean;
};

function pubkeyOrNull(value: string): PublicKey | null {
  const text = value.trim();
  if (!text) return null;
  try {
    return new PublicKey(text);
  } catch {
    return null;
  }
}

function formatAmount(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + whole.toString() + (fracText ? "." + fracText : "");
}

function statusLabel(deal: DealState): string {
  if (deal.status !== "open") return deal.status;
  if (deal.buyerLocked && deal.sellerLocked) return "open · both locked";
  if (deal.buyerLocked) return "open · buyer locked";
  if (deal.sellerLocked) return "open · seller locked";
  return "open · waiting for locks";
}

function roleOf(you: PublicKey | undefined, buyer: PublicKey, seller: PublicKey): "buyer" | "seller" | "other" | null {
  if (!you) return null;
  if (you.equals(buyer)) return "buyer";
  if (you.equals(seller)) return "seller";
  return "other";
}

function knownDecimals(mint: PublicKey): number | null {
  if (mint.equals(WRAPPED_SOL)) return 9;
  if (mint.equals(DEVNET_USDC)) return 6;
  return null;
}

export function Desk() {
  const shot = currentShot();
  const conn = useMemo(() => connection(), []);
  const [wallets, setWallets] = useState<InstalledWallet[]>(() =>
    typeof window === "undefined" ? [] : installedWallets(),
  );
  const [now, setNow] = useState(() => Date.now());
  const [session, setSession] = useState<Session | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(shot === "error" ? "No wallet in this browser." : null);
  const [signature, setSignature] = useState<string | null>(null);
  const [deal, setDeal] = useState<DealState | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [ref, setRef] = useState<DealRef | null>(null);
  const [role, setRole] = useState<"buyer" | "seller">("seller");
  const [paymentChoice, setPaymentChoice] = useState<"sol" | "usdc" | "custom">("sol");
  const [paymentMint, setPaymentMint] = useState(WRAPPED_SOL.toBase58());
  const [assetMint, setAssetMint] = useState("");
  const [assetAmount, setAssetAmount] = useState("1");
  const [itemLabel, setItemLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [expiry, setExpiry] = useState(String(60 * 60 * 24));
  const [theirSlip, setTheirSlip] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [payDecimals, setPayDecimals] = useState(9);
  const [myDeals, setMyDeals] = useState<StoredDeal[]>(() => (typeof window === "undefined" ? [] : loadMyDeals()));
  const [lowSol, setLowSol] = useState(false);
  const [shared, setShared] = useState(false);

  function applyRoute(route: Route) {
    if (route.kind === "invite") {
      setOffer(route.offer);
      setRef(null);
      setDeal(null);
      setRole(route.offer.role);
      setPaymentMint(route.offer.paymentMint);
      setAssetMint(route.offer.assetMint);
      setAssetAmount(route.offer.assetAmount);
      setItemLabel(route.offer.label);
      setExpiry(String(route.offer.expirySeconds));
      if (route.reveal) setTheirSlip(route.reveal);
      return;
    }
    if (route.kind === "legacy") {
      setRef(route.ref);
      setOffer(null);
      if (route.reveal) setTheirSlip(route.reveal);
      return;
    }
    if (route.kind === "deal") {
      setOffer(null);
      if (route.reveal) setTheirSlip(route.reveal);
    }
  }

  useEffect(() => {
    const again = () => setWallets(installedWallets());
    window.addEventListener("load", again);
    const timer = window.setTimeout(again, 400);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onHash = () => applyRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    applyRoute(parseRoute());
    return () => {
      window.removeEventListener("load", again);
      window.removeEventListener("hashchange", onHash);
      window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    programIsLive(conn)
      .then((value) => {
        if (!cancelled) setLive(value);
      })
      .catch(() => {
        if (!cancelled) setLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conn]);

  useEffect(() => {
    if (wallets.length === 0 || session) return;
    const saved = loadSiwsSession();
    if (!saved) return;
    let cancelled = false;
    void (async () => {
      for (const item of wallets) {
        try {
          const publicKey = await connectProvider(item.provider, true);
          if (cancelled) return;
          if (publicKey.toBase58() !== saved.address) continue;
          const message = buildSiwsMessage(saved);
          const ok = await verifyEd25519(saved.address, new TextEncoder().encode(message), base64ToBytes(saved.signature));
          if (!ok) {
            clearSiwsSession();
            return;
          }
          setSession({
            name: saved.walletName || item.name,
            provider: item.provider,
            publicKey,
            wallet: toDealWallet(item.provider, publicKey),
            signed: true,
          });
          return;
        } catch {
          continue;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, session]);

  useEffect(() => {
    if (!session) return;
    return listenProvider(session.provider, {
      onConnect: (publicKey) => {
        setSession((current) =>
          current ? { ...current, publicKey, wallet: toDealWallet(current.provider, publicKey) } : current,
        );
      },
      onDisconnect: () => {
        clearSiwsSession();
        setSession(null);
      },
      onAccount: (publicKey) => {
        if (!publicKey) {
          clearSiwsSession();
          setSession(null);
          return;
        }
        const saved = loadSiwsSession();
        if (!saved || saved.address !== publicKey.toBase58()) {
          clearSiwsSession();
          setSession((current) =>
            current
              ? { ...current, publicKey, wallet: toDealWallet(current.provider, publicKey), signed: false }
              : current,
          );
          return;
        }
        setSession((current) =>
          current ? { ...current, publicKey, wallet: toDealWallet(current.provider, publicKey), signed: true } : current,
        );
      },
    });
  }, [session]);

  useEffect(() => {
    if (!session) {
      setLowSol(false);
      return;
    }
    let cancelled = false;
    solLamports(conn, session.publicKey)
      .then((value) => {
        if (!cancelled) setLowSol(value < 20_000_000);
      })
      .catch(() => {
        if (!cancelled) setLowSol(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conn, session, signature]);

  useEffect(() => {
    const route = parseRoute();
    let cancelled = false;
    void (async () => {
      try {
        if (route.kind === "deal") {
          const loaded = await fetchDeal(route.address, CONFIG);
          if (cancelled) return;
          setDeal(loaded);
          if (loaded) {
            setRef({ buyer: loaded.buyer, seller: loaded.seller, id: loaded.id });
            if (route.reveal) {
              const own = storedSlipText(loaded.address.toBase58());
              if (!own || own !== route.reveal) {
                saveTheirReveal(loaded.address.toBase58(), route.reveal);
                setTheirSlip(route.reveal);
              }
            } else {
              const saved = loadTheirReveal(loaded.address.toBase58());
              if (saved) setTheirSlip(saved);
            }
          }
          return;
        }
        if (route.kind === "legacy") {
          const loaded = await fetchDeal(dealAddress(route.ref.buyer, route.ref.seller, route.ref.id, CONFIG), CONFIG);
          if (cancelled) return;
          setDeal(loaded);
          setRef(route.ref);
          return;
        }
        if (route.kind === "invite" && live) {
          const found = await findDealById(conn, new PublicKey(route.offer.creator), BigInt(route.offer.id));
          if (cancelled) return;
          if (found) {
            setDeal(found);
            setRef({ buyer: found.buyer, seller: found.seller, id: found.id });
            writeRoute("/d/" + found.address.toBase58());
            copySlip(offerSlipKey(route.offer.creator, route.offer.id), found.address.toBase58());
            updateMyDeal(
              (item) => item.id === route.offer.id && item.creator === route.offer.creator,
              { kind: "deal", address: found.address.toBase58(), buyer: found.buyer.toBase58(), seller: found.seller.toBase58(), status: statusLabel(found) },
            );
            setMyDeals(loadMyDeals());
          }
        }
      } catch (err) {
        if (!cancelled) setNotice(explainError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn, live, signature]);

  useEffect(() => {
    if (!offer || deal || !live) return;
    const timer = window.setInterval(() => {
      void findDealById(conn, new PublicKey(offer.creator), BigInt(offer.id)).then((found) => {
        if (!found) return;
        setDeal(found);
        setRef({ buyer: found.buyer, seller: found.seller, id: found.id });
        writeRoute("/d/" + found.address.toBase58());
        copySlip(offerSlipKey(offer.creator, offer.id), found.address.toBase58());
        setMyDeals(loadMyDeals());
      });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [conn, offer, deal, live]);

  useEffect(() => {
    const mint = deal?.paymentMint ?? pubkeyOrNull(paymentMint);
    if (!mint) return;
    const known = knownDecimals(mint);
    if (known !== null) {
      setPayDecimals(known);
      return;
    }
    let cancelled = false;
    mintDecimals(conn, mint)
      .then((value) => {
        if (!cancelled) setPayDecimals(value);
      })
      .catch(() => {
        if (!cancelled) setPayDecimals(0);
      });
    return () => {
      cancelled = true;
    };
  }, [conn, deal, paymentMint]);

  const yourRole = deal
    ? roleOf(session?.publicKey, deal.buyer, deal.seller)
    : offer && session
      ? session.publicKey.toBase58() === offer.creator
        ? offer.role
        : offer.role === "buyer"
          ? "seller"
          : "buyer"
      : ref
        ? roleOf(session?.publicKey, ref.buyer, ref.seller)
        : null;
  const isCreator = Boolean(offer && session && session.publicKey.toBase58() === offer.creator);
  const dealKey =
    deal?.address.toBase58() ??
    (ref ? dealAddress(ref.buyer, ref.seller, ref.id, CONFIG).toBase58() : null) ??
    (offer ? offerSlipKey(offer.creator, offer.id) : null);
  const ownSlip = dealKey
    ? storedSlipText(dealKey) ?? (offer ? storedSlipText(offerSlipKey(offer.creator, offer.id)) : null)
    : null;
  const canAct = Boolean(session && live);
  const bothLocked = Boolean(deal?.buyerLocked && deal?.sellerLocked);
  const finished = Boolean(deal && deal.status !== "open");
  const expired = Boolean(deal && Number(deal.expiryTs) * 1000 <= now);
  const youLocked = Boolean(
    deal && ((yourRole === "buyer" && deal.buyerLocked) || (yourRole === "seller" && deal.sellerLocked)),
  );
  const theyLocked = Boolean(
    deal && ((yourRole === "buyer" && deal.sellerLocked) || (yourRole === "seller" && deal.buyerLocked)),
  );
  const shareUrl = deal ? dealShareUrl(deal.address.toBase58()) : offer ? inviteShareUrl(offer) : "";
  const revealUrl = deal && ownSlip ? dealShareUrl(deal.address.toBase58(), ownSlip) : "";
  const itemTitle = (offer?.label || itemLabel || "this deal").trim();
  const paymentName = tokenLabel(deal?.paymentMint ?? paymentMint);
  const mood: Mood =
    notice && !signature
      ? "error"
      : deal?.status === "settled"
        ? "deal"
        : deal?.status === "refunded" || deal?.status === "cancelled"
          ? "nodeal"
          : bothLocked
            ? "match"
            : deal?.buyerLocked || deal?.sellerLocked
              ? "lock"
              : shot === "error" && !session
                ? "error"
                : "idle";
  const needsSolHelp =
    lowSol ||
    Boolean(notice && /devnet SOL for fees|enough SOL or tokens|insufficient/i.test(notice));

  async function connect(item: InstalledWallet) {
    setNotice(null);
    setBusy(true);
    try {
      const publicKey = await connectProvider(item.provider, false);
      if (canSignMessage(item.provider)) {
        const nonce = randomNonce();
        const issuedAt = new Date().toISOString();
        const fields = {
          domain: siwsDomain(),
          address: publicKey.toBase58(),
          uri: siwsUri(),
          chainId: appCluster(),
          nonce,
          issuedAt,
        };
        const message = buildSiwsMessage(fields);
        try {
          const signatureBytes = await signMessageBytes(item.provider, new TextEncoder().encode(message));
          const ok = await verifyEd25519(fields.address, new TextEncoder().encode(message), signatureBytes);
          if (!ok) throw new Error("The signed message could not be verified.");
          saveSiwsSession({
            ...fields,
            statement:
              "Sign in to BlindDeal. This proves you hold this wallet. It does not spend funds or lock a price.",
            signature: bytesToBase64(signatureBytes),
            walletName: item.name,
          });
          setSession({
            name: item.name,
            provider: item.provider,
            publicKey,
            wallet: toDealWallet(item.provider, publicKey),
            signed: true,
          });
        } catch (err) {
          try {
            await item.provider.disconnect?.();
          } catch {
                      }
          throw err;
        }
      } else {
        setSession({
          name: item.name,
          provider: item.provider,
          publicKey,
          wallet: toDealWallet(item.provider, publicKey),
          signed: false,
        });
      }
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await session?.provider.disconnect?.();
    } catch {
    }
    clearSiwsSession();
    setSession(null);
  }

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
  }

  async function shareLink(url: string, text: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title: "BlindDeal", text, url });
        setShared(true);
        window.setTimeout(() => setShared(false), 1600);
        return;
      } catch (err) {
        if (err instanceof Error && /abort|cancel/i.test(err.message)) return;
      }
    }
    await copy("link", url);
  }

  async function refresh(next = ref) {
    if (!next) return;
    setDeal(await fetchDeal(dealAddress(next.buyer, next.seller, next.id, CONFIG), CONFIG));
  }

  async function ensureAtas(owner: PublicKey, mints: PublicKey[]): Promise<TransactionInstruction[]> {
    const unique = [...new Map(mints.map((mint) => [mint.toBase58(), mint])).values()];
    const ixs: TransactionInstruction[] = [];
    for (const mint of unique) {
      const ata = associatedTokenAddress(mint, owner);
      const info = await conn.getAccountInfo(ata, "confirmed");
      if (!info) ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mint));
    }
    return ixs;
  }

  async function decimalsFor(mint: PublicKey): Promise<number> {
    const known = knownDecimals(mint);
    if (known !== null) return known;
    return mintDecimals(conn, mint);
  }

  function requireWallet(): Session {
    if (!session) throw new Error("Connect a wallet to continue.");
    return session;
  }

  function requireLiveAndWallet(): Session {
    const current = requireWallet();
    if (!live) throw new Error("The BlindDeal program is not on devnet yet, so a lock cannot be sent.");
    return current;
  }

  function choosePayment(choice: "sol" | "usdc" | "custom") {
    setPaymentChoice(choice);
    if (choice === "sol") setPaymentMint(WRAPPED_SOL.toBase58());
    if (choice === "usdc") setPaymentMint(DEVNET_USDC.toBase58());
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setSignature(null);
    try {
      const current = requireWallet();
      const payment = pubkeyOrNull(paymentMint);
      const asset = pubkeyOrNull(assetMint);
      if (!payment || !asset) throw new Error("Enter a valid payment token and the token being sold.");
      const paymentDecimals = await decimalsFor(payment);
      const assetDecimals = await decimalsFor(asset);
      const price = tokenAmount(secret, paymentDecimals);
      const assets = tokenAmount(assetAmount, assetDecimals);
      if (price <= 0n || assets <= 0n) throw new Error("Amounts must be greater than zero.");
      const id = BigInt(Date.now());
      const nextOffer: Offer = {
        version: 1,
        creator: current.publicKey.toBase58(),
        role,
        paymentMint: payment.toBase58(),
        assetMint: asset.toBase58(),
        assetAmount: assetAmount.trim(),
        label: itemLabel.trim().slice(0, 80),
        expirySeconds: Number(expiry) || 60 * 60 * 24,
        id: id.toString(),
      };
      const salt = randomSalt();
      const key = offerSlipKey(nextOffer.creator, nextOffer.id);
      saveSlip(key, { price, salt });
      upsertMyDeal({
        kind: "invite",
        id: nextOffer.id,
        creator: nextOffer.creator,
        role,
        paymentMint: nextOffer.paymentMint,
        assetMint: nextOffer.assetMint,
        assetAmount: nextOffer.assetAmount,
        label: nextOffer.label,
        expirySeconds: nextOffer.expirySeconds,
        createdAt: new Date().toISOString(),
        status: "waiting",
      });
      setMyDeals(loadMyDeals());
      writeRoute("/d/" + encodeOffer(nextOffer));
      setOffer(nextOffer);
      setDeal(null);
      setRef(null);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function lockWithSalt(
    current: Session,
    loaded: DealState,
    next: DealRef,
    acting: "buyer" | "seller",
    price: bigint,
    salt: Uint8Array,
  ) {
    const ixs: TransactionInstruction[] = [];
    if (acting === "buyer") {
      if (loaded.paymentMint.equals(WRAPPED_SOL)) {
        ixs.push(...(await wrapSolInstructions(conn, current.publicKey, price)));
      } else {
        ixs.push(...(await ensureAtas(current.publicKey, [loaded.paymentMint])));
      }
      ixs.push(
        lockBuyerInstruction({
          buyer: loaded.buyer,
          seller: loaded.seller,
          id: loaded.id,
          buyerPayment: associatedTokenAddress(loaded.paymentMint, loaded.buyer),
          paymentMint: loaded.paymentMint,
          commitment: commitment(price, salt),
          amount: price,
          config: CONFIG,
        }),
      );
    } else {
      ixs.push(...(await ensureAtas(current.publicKey, [loaded.assetMint])));
      ixs.push(
        lockSellerInstruction({
          buyer: loaded.buyer,
          seller: loaded.seller,
          id: loaded.id,
          sellerAsset: associatedTokenAddress(loaded.assetMint, loaded.seller),
          assetMint: loaded.assetMint,
          commitment: commitment(price, salt),
          config: CONFIG,
        }),
      );
    }
    const sig = await sendInstructions({ wallet: current.wallet, instructions: ixs, config: CONFIG });
    const address = loaded.address.toBase58();
    saveSlip(address, { price, salt });
    if (offer) copySlip(address, offerSlipKey(offer.creator, offer.id));
    setSignature(sig);
    await refresh(next);
  }

  async function onJoin() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!offer) throw new Error("Open a deal link first.");
      if (current.publicKey.toBase58() === offer.creator) {
        throw new Error("This is your deal link. Send it to the other side.");
      }
      const parties = offerParties(offer, current.publicKey);
      if (parties.buyer.equals(parties.seller)) throw new Error("Buyer and seller must be different wallets.");
      const payment = new PublicKey(offer.paymentMint);
      const asset = new PublicKey(offer.assetMint);
      const paymentDecimals = await decimalsFor(payment);
      const price = tokenAmount(secret, paymentDecimals);
      if (price <= 0n) throw new Error("Enter your secret limit.");
      const salt = randomSalt();
      const acting = offer.role === "buyer" ? "seller" : "buyer";
      const key = offerSlipKey(offer.creator, offer.id);
      saveSlip(key, { price, salt });
      if (acting !== "buyer") {
        const nextOffer = { ...offer, counterparty: current.publicKey.toBase58() };
        writeRoute("/d/" + encodeOffer(nextOffer));
        setOffer(nextOffer);
        upsertMyDeal({
          kind: "invite",
          id: offer.id,
          creator: offer.creator,
          role: acting,
          paymentMint: offer.paymentMint,
          assetMint: offer.assetMint,
          assetAmount: offer.assetAmount,
          label: offer.label,
          expirySeconds: offer.expirySeconds,
          createdAt: new Date().toISOString(),
          status: "return link",
        });
        setMyDeals(loadMyDeals());
        return;
      }
      const address = dealAddress(parties.buyer, parties.seller, parties.id, CONFIG);
      const ixs: TransactionInstruction[] = [
        createDealInstruction({
          buyer: parties.buyer,
          seller: parties.seller,
          id: parties.id,
          paymentMint: payment,
          assetMint: asset,
          assetAmount: tokenAmount(offer.assetAmount, await decimalsFor(asset)),
          expiryTs: expiryFromNow(offer.expirySeconds),
          config: CONFIG,
        }),
      ];
      if (acting === "buyer") {
        if (payment.equals(WRAPPED_SOL)) ixs.push(...(await wrapSolInstructions(conn, current.publicKey, price)));
        else ixs.push(...(await ensureAtas(current.publicKey, [payment])));
        ixs.push(
          lockBuyerInstruction({
            buyer: parties.buyer,
            seller: parties.seller,
            id: parties.id,
            buyerPayment: associatedTokenAddress(payment, parties.buyer),
            paymentMint: payment,
            commitment: commitment(price, salt),
            amount: price,
            config: CONFIG,
          }),
        );
      } else {
        ixs.push(...(await ensureAtas(current.publicKey, [asset])));
        ixs.push(
          lockSellerInstruction({
            buyer: parties.buyer,
            seller: parties.seller,
            id: parties.id,
            sellerAsset: associatedTokenAddress(asset, parties.seller),
            assetMint: asset,
            commitment: commitment(price, salt),
            config: CONFIG,
          }),
        );
      }
      const sig = await sendInstructions({ wallet: current.wallet, instructions: ixs, config: CONFIG });
      saveSlip(address.toBase58(), { price, salt });
      upsertMyDeal({
        kind: "deal",
        id: offer.id,
        address: address.toBase58(),
        buyer: parties.buyer.toBase58(),
        seller: parties.seller.toBase58(),
        creator: offer.creator,
        role: acting,
        paymentMint: offer.paymentMint,
        assetMint: offer.assetMint,
        assetAmount: offer.assetAmount,
        label: offer.label,
        expirySeconds: offer.expirySeconds,
        createdAt: new Date().toISOString(),
        status: "open",
      });
      setMyDeals(loadMyDeals());
      const next = parties;
      writeRoute("/d/" + address.toBase58());
      setRef(next);
      setSignature(sig);
      await refresh(next);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onOpenDeal() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!offer?.counterparty) throw new Error("Wait for the other side to join this link.");
      const parties = offerParties(offer, new PublicKey(offer.counterparty));
      const payment = new PublicKey(offer.paymentMint);
      const asset = new PublicKey(offer.assetMint);
      const existing = loadSlip(offerSlipKey(offer.creator, offer.id));
      if (!existing) throw new Error("This browser is missing your saved limit. Restore your backup to continue.");
      const address = dealAddress(parties.buyer, parties.seller, parties.id, CONFIG);
      const ixs: TransactionInstruction[] = [
        createDealInstruction({
          buyer: parties.buyer,
          seller: parties.seller,
          id: parties.id,
          paymentMint: payment,
          assetMint: asset,
          assetAmount: tokenAmount(offer.assetAmount, await decimalsFor(asset)),
          expiryTs: expiryFromNow(offer.expirySeconds),
          config: CONFIG,
        }),
      ];
      if (offer.role === "buyer") {
        if (payment.equals(WRAPPED_SOL)) ixs.push(...(await wrapSolInstructions(conn, current.publicKey, existing.price)));
        else ixs.push(...(await ensureAtas(current.publicKey, [payment])));
        ixs.push(
          lockBuyerInstruction({
            buyer: parties.buyer,
            seller: parties.seller,
            id: parties.id,
            buyerPayment: associatedTokenAddress(payment, parties.buyer),
            paymentMint: payment,
            commitment: commitment(existing.price, existing.salt),
            amount: existing.price,
            config: CONFIG,
          }),
        );
      }
      const sig = await sendInstructions({ wallet: current.wallet, instructions: ixs, config: CONFIG });
      saveSlip(address.toBase58(), existing);
      const next = parties;
      writeRoute("/d/" + address.toBase58());
      setRef(next);
      setSignature(sig);
      upsertMyDeal({
        kind: "deal",
        id: offer.id,
        address: address.toBase58(),
        buyer: parties.buyer.toBase58(),
        seller: parties.seller.toBase58(),
        creator: offer.creator,
        role: offer.role,
        paymentMint: offer.paymentMint,
        assetMint: offer.assetMint,
        assetAmount: offer.assetAmount,
        label: offer.label,
        expirySeconds: offer.expirySeconds,
        createdAt: new Date().toISOString(),
        status: "open",
      });
      setMyDeals(loadMyDeals());
      await refresh(next);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onLock() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!ref || !deal) throw new Error("Open a deal first.");
      if (yourRole !== "buyer" && yourRole !== "seller") {
        throw new Error("Only the buyer or the seller on this deal can lock.");
      }
      const paymentDecimals = await decimalsFor(deal.paymentMint);
      const existing = loadSlip(deal.address.toBase58()) ?? (offer ? loadSlip(offerSlipKey(offer.creator, offer.id)) : null);
      const price = existing?.price ?? tokenAmount(secret, paymentDecimals);
      const salt = existing?.salt ?? randomSalt();
      if (price <= 0n) throw new Error("Enter your secret limit.");
      await lockWithSalt(current, deal, ref, yourRole, price, salt);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  function settleAccounts(loaded: DealState, current: Session) {
    return {
      buyer: loaded.buyer,
      seller: loaded.seller,
      id: loaded.id,
      party: current.publicKey,
      buyerPayment: associatedTokenAddress(loaded.paymentMint, loaded.buyer),
      sellerPayment: associatedTokenAddress(loaded.paymentMint, loaded.seller),
      buyerAsset: associatedTokenAddress(loaded.assetMint, loaded.buyer),
      sellerAsset: associatedTokenAddress(loaded.assetMint, loaded.seller),
      paymentMint: loaded.paymentMint,
      assetMint: loaded.assetMint,
      config: CONFIG,
      wallet: current.wallet,
    };
  }

  async function onSettle() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!deal) throw new Error("Open a deal first.");
      const mine = loadSlip(deal.address.toBase58()) ?? (offer ? loadSlip(offerSlipKey(offer.creator, offer.id)) : null);
      const rawTheirs = theirSlip.trim() || loadTheirReveal(deal.address.toBase58()) || "";
      const theirs = rawTheirs ? decodeReveal(rawTheirs) : null;
      if (!mine || !theirs) throw new Error("Settle needs both reveals. Share yours, or paste theirs if you already have it.");
      const buyerReveal = yourRole === "buyer" ? mine : theirs;
      const sellerReveal = yourRole === "seller" ? mine : theirs;
      if (yourRole !== "buyer" && yourRole !== "seller") {
        throw new Error("Only the buyer or the seller can settle.");
      }
      const extras = await ensureAtas(current.publicKey, [deal.paymentMint, deal.assetMint]);
      if (extras.length) await sendInstructions({ wallet: current.wallet, instructions: extras, config: CONFIG });
      const sig = await settle({
        ...settleAccounts(deal, current),
        buyerPrice: buyerReveal.price,
        buyerSalt: buyerReveal.salt,
        sellerPrice: sellerReveal.price,
        sellerSalt: sellerReveal.salt,
      });
      saveTheirReveal(deal.address.toBase58(), rawTheirs);
      setSignature(sig);
      await refresh(ref);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!deal || !ref) throw new Error("Open a deal first.");
      const sig =
        yourRole === "buyer"
          ? await cancelBuyer({
              wallet: current.wallet,
              buyer: deal.buyer,
              seller: deal.seller,
              id: deal.id,
              buyerPayment: associatedTokenAddress(deal.paymentMint, deal.buyer),
              paymentMint: deal.paymentMint,
              config: CONFIG,
            })
          : yourRole === "seller"
            ? await cancelSeller({
                wallet: current.wallet,
                buyer: deal.buyer,
                seller: deal.seller,
                id: deal.id,
                sellerAsset: associatedTokenAddress(deal.assetMint, deal.seller),
                assetMint: deal.assetMint,
                config: CONFIG,
              })
            : (() => {
                throw new Error("Only the buyer or the seller can cancel.");
              })();
      setSignature(sig);
      await refresh(ref);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRefund() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!deal || !ref) throw new Error("Open a deal first.");
      const extras = await ensureAtas(current.publicKey, [deal.paymentMint, deal.assetMint]);
      if (extras.length) await sendInstructions({ wallet: current.wallet, instructions: extras, config: CONFIG });
      const sig = await refund(settleAccounts(deal, current));
      setSignature(sig);
      await refresh(ref);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    setBusy(true);
    setNotice(null);
    try {
      const current = requireLiveAndWallet();
      if (!deal || !ref) throw new Error("Open a deal first.");
      const sig = await closeDeal({
        wallet: current.wallet,
        buyer: deal.buyer,
        seller: deal.seller,
        id: deal.id,
        party: current.publicKey,
        initializer: deal.initializer,
        paymentMint: deal.paymentMint,
        assetMint: deal.assetMint,
        config: CONFIG,
      });
      setSignature(sig);
      await refresh(ref);
    } catch (err) {
      setNotice(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  function resetDeal() {
    setDeal(null);
    setRef(null);
    setOffer(null);
    setSignature(null);
    setNotice(null);
    setTheirSlip("");
    writeRoute("desk");
  }

  function openStored(item: StoredDeal) {
    setNotice(null);
    setSignature(null);
    if (item.address) {
      writeRoute("/d/" + item.address);
      applyRoute(parseRoute());
      return;
    }
    const stored: Offer = {
      version: 1,
      creator: item.creator,
      role: item.role,
      paymentMint: item.paymentMint,
      assetMint: item.assetMint,
      assetAmount: item.assetAmount,
      label: item.label,
      expirySeconds: item.expirySeconds,
      id: item.id,
    };
    writeRoute("/d/" + encodeOffer(stored));
    applyRoute(parseRoute());
  }

  function backup() {
    if (!ownSlip || !dealKey) return;
    const opened = decodeReveal(ownSlip);
    downloadText(
      "blinddeal-" + (dealKey.slice(0, 8)) + "-backup.txt",
      saltBackupText({
        deal: deal?.address.toBase58() ?? shareUrl,
        role: yourRole ?? role,
        label: itemTitle,
        priceText: formatAmount(opened.price, payDecimals) + " " + paymentName,
        slip: ownSlip,
        saltHex: bytesToHex(opened.salt),
      }),
    );
  }

  const showCreate = !deal && !offer;
  const waitingReturn = Boolean(offer && !deal && offer.counterparty && session && session.publicKey.toBase58() === offer.counterparty);
  const canOpenOnchain = Boolean(offer && !deal && offer.counterparty && isCreator && offer.role === "buyer");
  const showShare = Boolean(offer && !deal && (isCreator || !session || waitingReturn));
  const showJoin = Boolean(offer && session && !isCreator && !deal && !offer.counterparty);
  const showDeal = Boolean(deal);

  const steps = [
    { id: "link", label: "Deal link ready", on: Boolean(offer || deal) },
    { id: "open", label: "Both wallets in", on: Boolean(deal || (offer && session && !isCreator)) },
    { id: "you", label: "You locked", on: youLocked || Boolean(ownSlip && deal && youLocked) },
    { id: "them", label: "They locked", on: theyLocked },
    {
      id: "end",
      label: deal?.status === "settled" ? "Settled" : deal?.status === "refunded" ? "Refunded" : deal?.status === "cancelled" ? "Cancelled" : "Ready to settle",
      on: Boolean(finished || (bothLocked && ownSlip && theirSlip)),
    },
  ];

  return (
    <section id="desk">
      <p className="kicker">Open a deal</p>
      <Window title="Desk">
        <div className="banner">
          <span>
            {live === false
              ? "Your wallet can connect on devnet. The BlindDeal program is not deployed there yet, so a lock cannot be sent."
              : "Devnet. This is commit-reveal: your limit stays on this device until settle, when both prices appear in the transaction."}
          </span>
          <span className={live ? "tag good" : "tag"}>{live ? "Program live" : live === false ? "Program not on devnet" : "Checking program"}</span>
        </div>
        <div className="split">
          <div>
            <div className="row">
              <span className="tag sun">Devnet</span>
              {session?.signed ? <span className="tag good">Signed in</span> : session ? <span className="tag">{session.name}</span> : <span className="tag">Wallet</span>}
            </div>
            <p className="lede" style={{ fontSize: 16 }}>
              Connect, sign, and send a link. The other side only types their secret limit.
            </p>
            <p className="quiet">
              Privacy Rings is not connected yet. A settle transaction still carries both prices and salts.
            </p>
            {session ? (
              <div className="session-chip">
                <div>
                  <strong>{session.signed ? "Signed in" : "Connected"}</strong>
                  <p className="quiet" style={{ margin: 0 }}>
                    {session.name} · {shortKey(session.publicKey)}
                  </p>
                </div>
                <div className="row">
                  <a className="btn small" href={explorerAddress(session.publicKey.toBase58())} target="_blank" rel="noreferrer">
                    {shortKey(session.publicKey)}
                  </a>
                  <button className="btn small" type="button" onClick={() => void disconnect()} disabled={busy}>
                    Disconnect
                  </button>
                </div>
              </div>
            ) : wallets.length > 0 ? (
              <div className="wallet-list" style={{ marginTop: 16 }}>
                <p className="quiet" style={{ marginTop: 0 }}>
                  Connect your wallet, then sign a short message. That only proves you hold the wallet — it does not spend funds.
                </p>
                {wallets.map((item) => (
                  <button
                    key={item.name}
                    className="btn ink pressable"
                    type="button"
                    disabled={busy}
                    onClick={() => void connect(item)}
                  >
                    Connect {item.name}
                  </button>
                ))}
              </div>
            ) : needsWalletBrowse() ? (
              <div className="wallet-list" style={{ marginTop: 16 }}>
                <p className="quiet" style={{ marginTop: 0 }}>
                  Open this page in your wallet browser to connect and sign.
                </p>
                {walletBrowseLinks().map((item) => (
                  <a key={item.name} className="btn ink pressable" href={item.href}>
                    Open in {item.name}
                  </a>
                ))}
              </div>
            ) : (
              <div className="row" style={{ marginTop: 16 }}>
                <a className="btn ink pressable" href="https://phantom.app/" target="_blank" rel="noreferrer">
                  Install a Solana wallet
                </a>
              </div>
            )}
            {needsSolHelp && (
              <p className="note faucet-note" role="status">
                This wallet needs a little devnet SOL for fees.{" "}
                <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                  Request some from the faucet
                </a>
                .
              </p>
            )}
            {notice && (
              <p className="note" role="status" style={{ marginTop: 16 }}>
                {notice}
              </p>
            )}
            {signature && (
              <p className="quiet sig-row">
                Sent.{" "}
                <a href={explorerTx(signature)} target="_blank" rel="noreferrer">
                  View on explorer
                </a>
              </p>
            )}
            {myDeals.length > 0 && (
              <div className="deal-list">
                <p className="field-label">My deals</p>
                {myDeals.slice(0, 6).map((item) => (
                  <button
                    className="deal-item"
                    type="button"
                    key={(item.address ?? item.kind) + item.id}
                    onClick={() => openStored(item)}
                  >
                    <strong>{item.label || "Untitled deal"}</strong>
                    <span>
                      {item.role} · {item.status ?? item.kind}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ marginTop: 18 }}>
              <Mascot mood={mood} size={140} />
            </div>
          </div>
          <div>
            {showCreate && (
              <form className="form" onSubmit={(event) => void onCreate(event)}>
                <div className="row pill-row">
                  <button className={role === "seller" ? "btn small sun" : "btn small"} type="button" onClick={() => setRole("seller")}>
                    I want to sell
                  </button>
                  <button className={role === "buyer" ? "btn small sun" : "btn small"} type="button" onClick={() => setRole("buyer")}>
                    I want to buy
                  </button>
                </div>
                <label className="field">
                  <span>Item</span>
                  <input
                    className="num"
                    value={itemLabel}
                    onChange={(event) => setItemLabel(event.target.value)}
                    placeholder="A short label the other side will see"
                    aria-label="Item label"
                    autoComplete="off"
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Amount</span>
                    <input
                      className="num"
                      inputMode="decimal"
                      value={assetAmount}
                      onChange={(event) => setAssetAmount(event.target.value)}
                      aria-label="Asset amount"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Token being sold</span>
                    <input
                      className="num"
                      value={assetMint}
                      onChange={(event) => setAssetMint(event.target.value)}
                      placeholder="Mint address"
                      aria-label="Asset mint"
                      autoComplete="off"
                      required
                    />
                  </label>
                </div>
                <div className="field">
                  <span>Paid in</span>
                  <div className="row pill-row">
                    <button className={paymentChoice === "sol" ? "btn small sun" : "btn small"} type="button" onClick={() => choosePayment("sol")}>
                      Devnet SOL
                    </button>
                    <button className={paymentChoice === "usdc" ? "btn small sun" : "btn small"} type="button" onClick={() => choosePayment("usdc")}>
                      Devnet USDC
                    </button>
                    <button className={paymentChoice === "custom" ? "btn small sun" : "btn small"} type="button" onClick={() => choosePayment("custom")}>
                      Other mint
                    </button>
                  </div>
                  {paymentChoice === "custom" && (
                    <input
                      className="num"
                      value={paymentMint}
                      onChange={(event) => setPaymentMint(event.target.value)}
                      placeholder="Payment mint"
                      aria-label="Payment mint"
                      autoComplete="off"
                      required
                    />
                  )}
                </div>
                <div className="form-grid">
                  <label className="field">
                    <span>{role === "buyer" ? "Your secret maximum" : "Your secret minimum"}</span>
                    <input
                      className="num"
                      inputMode="decimal"
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                      placeholder={"In " + tokenLabel(paymentMint) + ". Stays on this device."}
                      aria-label="Secret limit"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Expires</span>
                    <select className="num" value={expiry} onChange={(event) => setExpiry(event.target.value)} aria-label="Expiry">
                      {EXPIRY_OPTIONS.map((item) => (
                        <option key={item.seconds} value={item.seconds}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button className="btn sun pressable" type="submit" disabled={busy || !session}>
                  Create deal link
                </button>
                {!session && <p className="quiet">Connect and sign in to create a link.</p>}
                {session && live === false && (
                  <p className="quiet">You can still make a link now. Locks will send once the program is on devnet.</p>
                )}
              </form>
            )}
            {showShare && offer && (
              <div className="share-card">
                <p className="field-label">Share this deal</p>
                <ol className="timeline" aria-label="Deal status">
                  {steps.map((step) => (
                    <li key={step.id} className={step.on ? "tl-step is-done" : "tl-step"}>
                      <span className="tl-dot" />
                      {step.label}
                    </li>
                  ))}
                </ol>
                <h3>{itemTitle === "this deal" ? "Your deal link is ready" : itemTitle}</h3>
                <p className="quiet" style={{ marginTop: 6 }}>
                  You are the {offer.role}. They will see the amount and token, then type only their secret limit.
                </p>
                <div className="qr-wrap">
                  <QrCode text={shareUrl} title="Deal link QR code" />
                </div>
                <p className="share-url">{shareUrl}</p>
                <div className="row">
                  <button className="btn sun pressable" type="button" onClick={() => void copy("link", shareUrl)}>
                    {copied === "link" ? "Link copied" : "Copy link"}
                  </button>
                  <button className="btn pressable" type="button" onClick={() => void shareLink(shareUrl, "Open this BlindDeal link and type your secret limit.")}>
                    {shared ? "Shared" : "Share"}
                  </button>
                  {ownSlip && (
                    <button className="btn small" type="button" onClick={backup}>
                      Download backup
                    </button>
                  )}
                </div>
                <p className="quiet">Your salt was saved on this device. Download a backup if you might switch browsers.</p>
                {canOpenOnchain && (
                  <button className="btn sun pressable" type="button" disabled={busy || !canAct} onClick={() => void onOpenDeal()}>
                    Open deal and lock my price
                  </button>
                )}
                {waitingReturn && (
                  <p className="quiet">Share this return link. The buyer has to open the deal, because they sign the first transaction.</p>
                )}
                {live === false && <p className="quiet">Waiting for the program on devnet before a lock can be sent.</p>}
                {live && !canOpenOnchain && !waitingReturn && <p className="quiet">Waiting for the other side to open the link and lock.</p>}
                {canOpenOnchain && live && <p className="quiet">They joined. Open the deal and lock the limit already saved on this device.</p>}
                <button className="btn" type="button" onClick={resetDeal}>
                  New deal
                </button>
              </div>
            )}
            {showJoin && offer && (
              <div className="form">
                <div className="share-card compact">
                  <p className="field-label">Deal summary</p>
                  <h3>{offer.label || "Open deal"}</h3>
                  <div className="explorer">
                    <div className="ex-row">
                      <span>they are</span>
                      <strong>the {offer.role}</strong>
                    </div>
                    <div className="ex-row">
                      <span>you are</span>
                      <strong>the {offer.role === "buyer" ? "seller" : "buyer"}</strong>
                    </div>
                    <div className="ex-row">
                      <span>amount</span>
                      <strong>{offer.assetAmount}</strong>
                    </div>
                    <div className="ex-row">
                      <span>token</span>
                      <strong>{shortKey(offer.assetMint)}</strong>
                    </div>
                    <div className="ex-row">
                      <span>paid in</span>
                      <strong>{tokenLabel(offer.paymentMint)}</strong>
                    </div>
                    <div className="ex-row">
                      <span>their wallet</span>
                      <strong>{shortKey(offer.creator)}</strong>
                    </div>
                  </div>
                </div>
                <label className="field">
                  <span>{offer.role === "buyer" ? "Your secret minimum" : "Your secret maximum"}</span>
                  <input
                    className="num"
                    inputMode="decimal"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={"In " + tokenLabel(offer.paymentMint) + ". Stays on this device."}
                    aria-label="Secret limit"
                    required
                  />
                </label>
                <button className="btn sun pressable" type="button" disabled={busy || !secret.trim() || (offer.role === "seller" ? !canAct : !session)} onClick={() => void onJoin()}>
                  {offer.role === "buyer" ? "Save my price and make a return link" : "Lock my price"}
                </button>
                {offer.role === "buyer" && (
                  <p className="quiet">The buyer has to sign the first transaction. You will get a return link to send back, then lock in one tap.</p>
                )}
                {live === false && offer.role === "seller" && <p className="quiet">The program is not on devnet yet, so this lock cannot be sent.</p>}
              </div>
            )}
            {showDeal && deal && (
              <div className="form">
                <ol className="timeline" aria-label="Deal status">
                  {steps.map((step) => (
                    <li key={step.id} className={step.on ? "tl-step is-done" : "tl-step"}>
                      <span className="tl-dot" />
                      {step.label}
                    </li>
                  ))}
                </ol>
                <div className="explorer" aria-label="Deal details">
                  <div className="ex-row">
                    <span>status</span>
                    <strong>{statusLabel(deal)}</strong>
                  </div>
                  {itemTitle !== "this deal" && (
                    <div className="ex-row">
                      <span>item</span>
                      <strong>{itemTitle}</strong>
                    </div>
                  )}
                  <div className="ex-row">
                    <span>buyer</span>
                    <strong>{shortKey(deal.buyer)}</strong>
                  </div>
                  <div className="ex-row">
                    <span>seller</span>
                    <strong>{shortKey(deal.seller)}</strong>
                  </div>
                  <div className="ex-row">
                    <span>asset</span>
                    <strong>
                      {deal.assetAmount.toString()} · {shortKey(deal.assetMint)}
                    </strong>
                  </div>
                  <div className="ex-row">
                    <span>paid in</span>
                    <strong>{paymentName}</strong>
                  </div>
                  <div className="ex-row">
                    <span>buyer deposit</span>
                    <strong>{deal.buyerLocked ? formatAmount(deal.buyerDeposit, payDecimals) : "unlocked"}</strong>
                  </div>
                  <div className="ex-row">
                    <span>expires</span>
                    <strong>{new Date(Number(deal.expiryTs) * 1000).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" })} WIB</strong>
                  </div>
                </div>
                {shareUrl && (
                  <div className="share-card compact">
                    <p className="field-label">Share link</p>
                    <div className="qr-wrap small">
                      <QrCode text={shareUrl} size={148} title="Deal link QR code" />
                    </div>
                    <div className="row">
                      <button className="btn small sun" type="button" onClick={() => void copy("link", shareUrl)}>
                        {copied === "link" ? "Link copied" : "Copy link"}
                      </button>
                      <button className="btn small" type="button" onClick={() => void shareLink(shareUrl, "Open this BlindDeal link.")}>
                        {shared ? "Shared" : "Share"}
                      </button>
                      <a className="btn small" href={explorerAddress(deal.address.toBase58())} target="_blank" rel="noreferrer">
                        Account
                      </a>
                    </div>
                  </div>
                )}
                {yourRole !== "other" &&
                  !finished &&
                  ((yourRole === "buyer" && !deal.buyerLocked) || (yourRole === "seller" && !deal.sellerLocked)) && (
                    <>
                      {ownSlip ? (
                        <button className="btn sun pressable" type="button" disabled={busy || !canAct} onClick={() => void onLock()}>
                          Lock my saved price
                        </button>
                      ) : (
                        <>
                          <label className="field">
                            <span>{yourRole === "buyer" ? "Your secret maximum" : "Your secret minimum"}</span>
                            <input
                              className="num"
                              inputMode="decimal"
                              value={secret}
                              onChange={(event) => setSecret(event.target.value)}
                              aria-label="Secret limit"
                            />
                          </label>
                          <button className="btn sun pressable" type="button" disabled={busy || !canAct} onClick={() => void onLock()}>
                            Lock my price
                          </button>
                        </>
                      )}
                    </>
                  )}
                {ownSlip && (
                  <div className="row">
                    <button className="btn small" type="button" onClick={backup}>
                      Download backup
                    </button>
                  </div>
                )}
                {bothLocked && !finished && (
                  <div className="note">
                    <strong>Both sides locked.</strong> Share your reveal so you can settle in one tap. Your number stays on this device until then.
                    <div className="row" style={{ marginTop: 10 }}>
                      {revealUrl && (
                        <>
                          <button className="btn small sun" type="button" onClick={() => void copy("reveal", revealUrl)}>
                            {copied === "reveal" ? "Reveal link copied" : "Copy reveal link"}
                          </button>
                          <button className="btn small" type="button" onClick={() => void shareLink(revealUrl, "Here is my BlindDeal reveal. Use it to settle.")}>
                            Share reveal
                          </button>
                        </>
                      )}
                    </div>
                    {!theirSlip && (
                      <label className="field" style={{ marginTop: 12 }}>
                        <span>Their reveal</span>
                        <textarea
                          className="area"
                          value={theirSlip}
                          onChange={(event) => setTheirSlip(event.target.value)}
                          placeholder="Paste their reveal link or slip if they sent it another way"
                          aria-label="Their reveal slip"
                        />
                      </label>
                    )}
                    <button
                      className="btn sun pressable"
                      type="button"
                      disabled={busy || !canAct || !ownSlip || !(theirSlip.trim() || loadTheirReveal(deal.address.toBase58()))}
                      onClick={() => void onSettle()}
                      style={{ marginTop: 12 }}
                    >
                      Settle
                    </button>
                  </div>
                )}
                <div className="row">
                  {deal.status === "open" && !bothLocked && yourRole !== "other" && youLocked && (
                    <button className="btn" type="button" disabled={busy || !canAct} onClick={() => void onCancel()}>
                      Cancel my lock
                    </button>
                  )}
                  {deal.status === "open" && bothLocked && expired && (
                    <button className="btn" type="button" disabled={busy || !canAct} onClick={() => void onRefund()}>
                      Refund expired deal
                    </button>
                  )}
                  {finished && (
                    <button className="btn" type="button" disabled={busy || !canAct} onClick={() => void onClose()}>
                      Close and return rent
                    </button>
                  )}
                  <button className="btn" type="button" onClick={resetDeal}>
                    New deal
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Window>
    </section>
  );
}
