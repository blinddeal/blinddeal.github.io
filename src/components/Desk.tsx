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
  DEFAULT_EXPIRY_SECONDS,
  DEVNET_USDC,
  DEVNET_USDT,
  FAUCET_URL,
  HIDDEN_ASSET_AMOUNT,
  HIDDEN_ASSET_MINT,
  WRAPPED_SOL,
  appCluster,
  connection,
  explorerAddress,
  explorerTx,
  missingPaymentHelp,
  mintDecimals,
  paymentChoiceFor,
  paymentMintFor,
  programIsLive,
  solLamports,
  tokenBalance,
  tokenLabel,
  type PaymentChoice,
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
  if (mint.equals(DEVNET_USDC) || mint.equals(DEVNET_USDT)) return 6;
  return null;
}

function secretHelper(acting: "buyer" | "seller"): string {
  return acting === "buyer"
    ? "Only you see this. The seller never will."
    : "Only you see this. The buyer never will.";
}

function counterpartyPrompt(offer: Offer, who: string): string {
  const item = offer.label.trim() || "something";
  if (offer.role === "seller") return who + " is selling " + item + ". Enter the most you'd pay.";
  return who + " wants to buy " + item + ". Enter the lowest price you'd accept.";
}

type PaymentHelp = { token: string; text: string; href?: string; linkLabel?: string };

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
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("usdc");
  const [paymentMint, setPaymentMint] = useState(DEVNET_USDC.toBase58());
  const [itemLabel, setItemLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [expiry] = useState(String(DEFAULT_EXPIRY_SECONDS));
  const [theirSlip, setTheirSlip] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [payDecimals, setPayDecimals] = useState(6);
  const [myDeals, setMyDeals] = useState<StoredDeal[]>(() => (typeof window === "undefined" ? [] : loadMyDeals()));
  const [lowSol, setLowSol] = useState(false);
  const [shared, setShared] = useState(false);
  const [paymentHelp, setPaymentHelp] = useState<PaymentHelp | null>(null);

  function applyRoute(route: Route) {
    if (route.kind === "invite") {
      setOffer(route.offer);
      setRef(null);
      setDeal(null);
      setRole(route.offer.role);
      setPaymentMint(route.offer.paymentMint);
      setPaymentChoice(paymentChoiceFor(route.offer.paymentMint) ?? "usdc");
      setItemLabel(route.offer.label);
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
    Boolean(notice && /devnet SOL for fees/.test(notice));
  const actingBuyer =
    yourRole === "buyer" ||
    Boolean(offer && !deal && ((isCreator && offer.role === "buyer") || (!isCreator && offer.role === "seller")));

  useEffect(() => {
    if (!session || !actingBuyer) return;
    const mint = deal?.paymentMint ?? (offer ? new PublicKey(offer.paymentMint) : paymentMintFor(paymentChoice));
    if (mint.equals(WRAPPED_SOL)) return;
    let cancelled = false;
    void tokenBalance(conn, session.publicKey, mint).then((have) => {
      if (cancelled) return;
      if (have === 0n) setPaymentHelp(missingPaymentHelp(mint));
      else setPaymentHelp(null);
    });
    return () => {
      cancelled = true;
    };
  }, [session, deal, offer, actingBuyer, paymentChoice, conn]);

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

  function choosePayment(choice: PaymentChoice) {
    setPaymentChoice(choice);
    setPaymentMint(paymentMintFor(choice).toBase58());
    setPaymentHelp(null);
  }

  async function assertPayment(owner: PublicKey, mint: PublicKey, amount: bigint) {
    if (mint.equals(WRAPPED_SOL)) return;
    const have = await tokenBalance(conn, owner, mint);
    if (have < amount) {
      const help = missingPaymentHelp(mint);
      setPaymentHelp(help);
      throw new Error(help.text);
    }
    setPaymentHelp(null);
  }

  async function prepareAssetLock(owner: PublicKey, mint: PublicKey, amount: bigint): Promise<TransactionInstruction[]> {
    if (mint.equals(WRAPPED_SOL)) return wrapSolInstructions(conn, owner, amount);
    return ensureAtas(owner, [mint]);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setSignature(null);
    try {
      const current = requireWallet();
      const payment = paymentMintFor(paymentChoice);
      const paymentDecimals = await decimalsFor(payment);
      const price = tokenAmount(secret, paymentDecimals);
      if (price <= 0n) throw new Error("Enter a price greater than zero.");
      const id = BigInt(Date.now());
      const nextOffer: Offer = {
        version: 1,
        creator: current.publicKey.toBase58(),
        role,
        paymentMint: payment.toBase58(),
        assetMint: HIDDEN_ASSET_MINT.toBase58(),
        assetAmount: HIDDEN_ASSET_AMOUNT,
        label: itemLabel.trim().slice(0, 80),
        expirySeconds: Number(expiry) || DEFAULT_EXPIRY_SECONDS,
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
      ixs.push(...(await prepareAssetLock(current.publicKey, loaded.assetMint, loaded.assetAmount)));
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
      if (price <= 0n) throw new Error("Enter a price greater than zero.");
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
        await assertPayment(current.publicKey, payment, price);
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
        ixs.push(...(await prepareAssetLock(current.publicKey, asset, tokenAmount(offer.assetAmount, await decimalsFor(asset)))));
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
      if (!existing) throw new Error("This browser is missing your saved price. Restore your backup to continue.");
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
        await assertPayment(current.publicKey, payment, existing.price);
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
      if (price <= 0n) throw new Error("Enter a price greater than zero.");
      if (yourRole === "buyer") await assertPayment(current.publicKey, deal.paymentMint, price);
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
      if (!mine || !theirs) throw new Error("Settle needs both prices. Share your settle link, or paste theirs if you already have it.");
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
              : "Devnet. Your price stays on this device until you settle. Both prices still appear in that transaction."}
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
              Connect, sign in, and send a link. The other side only types a secret price.
            </p>
            <p className="quiet">
              Privacy Rings is not connected yet. When you settle, both prices still appear in the transaction.
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
            {paymentHelp && (
              <p className="note faucet-note" role="status">
                {paymentHelp.text}
                {paymentHelp.href ? (
                  <>
                    {" "}
                    <a href={paymentHelp.href} target="_blank" rel="noreferrer">
                      {paymentHelp.linkLabel ?? "Open the faucet"}
                    </a>
                    .
                  </>
                ) : null}
              </p>
            )}
            {notice && notice !== paymentHelp?.text && (
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
                <ol className="how-mini" aria-label="How it works">
                  <li data-step="1">
                    <span>
                      <strong>Set your secret price.</strong> Only you see the number.
                    </span>
                  </li>
                  <li data-step="2">
                    <span>
                      <strong>Send the link.</strong> The other person sets theirs the same way.
                    </span>
                  </li>
                  <li data-step="3">
                    <span>
                      <strong>Meet in the middle, or walk away.</strong> If the prices miss, nobody sees a number.
                    </span>
                  </li>
                </ol>
                <div className="row pill-row">
                  <button className={role === "seller" ? "btn small sun" : "btn small"} type="button" onClick={() => setRole("seller")}>
                    I want to sell
                  </button>
                  <button className={role === "buyer" ? "btn small sun" : "btn small"} type="button" onClick={() => setRole("buyer")}>
                    I want to buy
                  </button>
                </div>
                <label className="field">
                  <span>{role === "seller" ? "What are you selling?" : "What do you want to buy?"}</span>
                  <input
                    className="num"
                    value={itemLabel}
                    onChange={(event) => setItemLabel(event.target.value)}
                    placeholder={role === "seller" ? "1 sticker pack" : "A short label they will see"}
                    aria-label={role === "seller" ? "What are you selling?" : "What do you want to buy?"}
                    autoComplete="off"
                  />
                </label>
                <div className="price-box">
                  <span className="field-label">{role === "seller" ? "Lowest price you'd accept" : "Most you'd pay"}</span>
                  <p className="field-help">{secretHelper(role)}</p>
                  <div className="price-row">
                    <input
                      className="num"
                      inputMode="decimal"
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                      placeholder="0.00"
                      aria-label={role === "seller" ? "Lowest price you'd accept" : "Most you'd pay"}
                      required
                    />
                    <div className="row pill-row">
                      <button className={paymentChoice === "usdc" ? "btn small sun" : "btn small"} type="button" onClick={() => choosePayment("usdc")}>
                        USDC
                      </button>
                      <button className={paymentChoice === "usdt" ? "btn small sun" : "btn small"} type="button" onClick={() => choosePayment("usdt")}>
                        USDT
                      </button>
                    </div>
                  </div>
                </div>
                <button className="btn sun pressable" type="submit" disabled={busy || !session}>
                  Get link
                </button>
                {!session && <p className="quiet">Connect and sign in to get a link.</p>}
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
                  {offer.role === "seller"
                    ? "You are selling " + (offer.label.trim() || "this item") + ". Send the link. They only type the most they'd pay."
                    : "You want to buy " + (offer.label.trim() || "this item") + ". Send the link. They only type the lowest price they'd accept."}
                </p>
                <div className="qr-wrap">
                  <QrCode text={shareUrl} title="Deal link QR code" />
                </div>
                <p className="share-url">{shareUrl}</p>
                <div className="row">
                  <button className="btn sun pressable" type="button" onClick={() => void copy("link", shareUrl)}>
                    {copied === "link" ? "Link copied" : "Copy link"}
                  </button>
                  <button className="btn pressable" type="button" onClick={() => void shareLink(shareUrl, "Open this BlindDeal link and set your price.")}>
                    {shared ? "Shared" : "Share"}
                  </button>
                </div>
                {ownSlip && (
                  <p className="quiet">
                    A backup was saved on this device.{" "}
                    <button className="text-link" type="button" onClick={backup}>
                      Save backup
                    </button>
                  </p>
                )}
                {canOpenOnchain && (
                  <button className="btn sun pressable" type="button" disabled={busy || !canAct} onClick={() => void onOpenDeal()}>
                    Open the deal and lock my price
                  </button>
                )}
                {waitingReturn && (
                  <p className="quiet">Send this link back so they can open the deal.</p>
                )}
                {live === false && <p className="quiet">Waiting for the program on devnet before a lock can be sent.</p>}
                {live && !canOpenOnchain && !waitingReturn && <p className="quiet">Waiting for the other side to open the link and set their price.</p>}
                {canOpenOnchain && live && <p className="quiet">They joined. Open the deal and lock the price saved on this device.</p>}
                <button className="btn" type="button" onClick={resetDeal}>
                  New deal
                </button>
              </div>
            )}
            {showJoin && offer && (
              <div className="form">
                <p className="lede" style={{ fontSize: 16, marginTop: 0 }}>
                  {counterpartyPrompt(offer, shortKey(offer.creator))}
                </p>
                <p className="field-help">Paid in {tokenLabel(offer.paymentMint)}. {secretHelper(offer.role === "buyer" ? "seller" : "buyer")}</p>
                <label className="field">
                  <input
                    className="num"
                    inputMode="decimal"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="0.00"
                    aria-label={offer.role === "buyer" ? "Lowest price you'd accept" : "Most you'd pay"}
                    required
                  />
                </label>
                <button className="btn sun pressable" type="button" disabled={busy || !secret.trim() || (offer.role === "seller" ? !canAct : !session)} onClick={() => void onJoin()}>
                  Set my price
                </button>
                {offer.role === "buyer" && (
                  <p className="quiet">After you set your price, you will get a link to send back.</p>
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
                    <span>paid in</span>
                    <strong>{paymentName}</strong>
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
                        View on explorer
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
                          Lock my price
                        </button>
                      ) : (
                        <>
                          <label className="field">
                            <span>{yourRole === "buyer" ? "Most you'd pay" : "Lowest price you'd accept"}</span>
                            <p className="field-help">{yourRole === "buyer" || yourRole === "seller" ? secretHelper(yourRole) : ""}</p>
                            <input
                              className="num"
                              inputMode="decimal"
                              value={secret}
                              onChange={(event) => setSecret(event.target.value)}
                              placeholder="0.00"
                              aria-label={yourRole === "buyer" ? "Most you'd pay" : "Lowest price you'd accept"}
                            />
                          </label>
                          <button className="btn sun pressable" type="button" disabled={busy || !canAct} onClick={() => void onLock()}>
                            Set my price
                          </button>
                        </>
                      )}
                    </>
                  )}
                {ownSlip && (
                  <p className="quiet">
                    A backup was saved on this device.{" "}
                    <button className="text-link" type="button" onClick={backup}>
                      Save backup
                    </button>
                  </p>
                )}
                {bothLocked && !finished && (
                  <div className="note">
                    <strong>Both sides locked.</strong> Share your settle link so you can finish in one tap. Your number stays on this device until then.
                    <div className="row" style={{ marginTop: 10 }}>
                      {revealUrl && (
                        <>
                          <button className="btn small sun" type="button" onClick={() => void copy("reveal", revealUrl)}>
                            {copied === "reveal" ? "Settle link copied" : "Copy settle link"}
                          </button>
                          <button className="btn small" type="button" onClick={() => void shareLink(revealUrl, "Here is my BlindDeal settle link.")}>
                            Share settle link
                          </button>
                        </>
                      )}
                    </div>
                    {!theirSlip && (
                      <label className="field" style={{ marginTop: 12 }}>
                        <span>Their settle link</span>
                        <textarea
                          className="area"
                          value={theirSlip}
                          onChange={(event) => setTheirSlip(event.target.value)}
                          placeholder="Paste their settle link if they sent it another way"
                          aria-label="Their settle link"
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
