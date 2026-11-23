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
  lockSeller,
  lockSellerInstruction,
  randomSalt,
  refund,
  sendInstructions,
  settle,
  tokenAmount,
  type DealState,
  type DealWallet,
} from "blinddeal-sdk";
import { CONFIG, DEVNET_USDC, connection, explorerAddress, explorerTx, mintDecimals, programIsLive } from "../cluster";
import { explainError } from "../errors";
import { dealLink, loadSlip, parseDealRef, saveSlip, storedSlipText, writeDealHash, type DealRef } from "../session";
import { currentShot } from "../shot";
import {
  connectProvider,
  installedWallets,
  listenProvider,
  shortKey,
  toDealWallet,
  type InstalledWallet,
  type SolanaProvider,
} from "../wallet";
import { Mascot, type Mood } from "./Mascot";
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
  const [ref, setRef] = useState<DealRef | null>(() => (typeof window === "undefined" ? null : parseDealRef()));
  const [role, setRole] = useState<"buyer" | "seller">("buyer");
  const [counterparty, setCounterparty] = useState("");
  const [paymentMint, setPaymentMint] = useState(DEVNET_USDC.toBase58());
  const [assetMint, setAssetMint] = useState("");
  const [assetAmount, setAssetAmount] = useState("1");
  const [secret, setSecret] = useState("");
  const [deposit, setDeposit] = useState("");
  const [expiry, setExpiry] = useState(String(60 * 60 * 24));
  const [theirSlip, setTheirSlip] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [payDecimals, setPayDecimals] = useState(0);

  useEffect(() => {
    const again = () => setWallets(installedWallets());
    window.addEventListener("load", again);
    const timer = window.setTimeout(again, 400);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener("load", again);
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
    let cancelled = false;
    void (async () => {
      for (const item of wallets) {
        try {
          const publicKey = await connectProvider(item.provider, true);
          if (cancelled) return;
          setSession({
            name: item.name,
            provider: item.provider,
            publicKey,
            wallet: toDealWallet(item.provider, publicKey),
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
      onDisconnect: () => setSession(null),
      onAccount: (publicKey) => {
        if (!publicKey) {
          setSession(null);
          return;
        }
        setSession((current) =>
          current ? { ...current, publicKey, wallet: toDealWallet(current.provider, publicKey) } : current,
        );
      },
    });
  }, [session]);

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    fetchDeal(dealAddress(ref.buyer, ref.seller, ref.id, CONFIG), CONFIG)
      .then((value) => {
        if (!cancelled) setDeal(value);
      })
      .catch((err) => {
        if (!cancelled) setNotice(explainError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ref, signature]);

  useEffect(() => {
    if (!deal) return;
    let cancelled = false;
    mintDecimals(conn, deal.paymentMint)
      .then((value) => {
        if (!cancelled) setPayDecimals(value);
      })
      .catch(() => {
        if (!cancelled) setPayDecimals(0);
      });
    return () => {
      cancelled = true;
    };
  }, [conn, deal]);

  const yourRole = deal
    ? roleOf(session?.publicKey, deal.buyer, deal.seller)
    : ref
      ? roleOf(session?.publicKey, ref.buyer, ref.seller)
      : null;
  const dealKey = deal?.address.toBase58() ?? (ref ? dealAddress(ref.buyer, ref.seller, ref.id, CONFIG).toBase58() : null);
  const ownSlip = dealKey ? storedSlipText(dealKey) : null;
  const canAct = Boolean(session && live);
  const bothLocked = Boolean(deal?.buyerLocked && deal?.sellerLocked);
  const finished = Boolean(deal && deal.status !== "open");
  const expired = Boolean(deal && Number(deal.expiryTs) * 1000 <= now);
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

  async function connect(item: InstalledWallet) {
    setNotice(null);
    setBusy(true);
    try {
      const publicKey = await connectProvider(item.provider, false);
      setSession({
        name: item.name,
        provider: item.provider,
        publicKey,
        wallet: toDealWallet(item.provider, publicKey),
      });
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
      setSession(null);
      return;
    }
    setSession(null);
  }

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
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

  function requireLiveAndWallet(): Session {
    if (!session) throw new Error("Connect a wallet to open a deal.");
    if (!live) throw new Error("The BlindDeal program is not on devnet yet, so a lock cannot be sent.");
    return session;
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setSignature(null);
    try {
      const current = requireLiveAndWallet();
      const buyer = role === "buyer" ? current.publicKey : pubkeyOrNull(counterparty);
      const seller = role === "seller" ? current.publicKey : pubkeyOrNull(counterparty);
      const payment = pubkeyOrNull(paymentMint);
      const asset = pubkeyOrNull(assetMint);
      if (!buyer || !seller || !payment || !asset) {
        throw new Error("Enter valid Solana addresses for the other side and both mints.");
      }
      if (buyer.equals(seller)) throw new Error("Buyer and seller must be different wallets.");
      const paymentDecimals = await mintDecimals(conn, payment);
      const assetDecimals = await mintDecimals(conn, asset);
      const price = tokenAmount(secret, paymentDecimals);
      const amount = tokenAmount(deposit.trim() || secret, paymentDecimals);
      const assets = tokenAmount(assetAmount, assetDecimals);
      if (price <= 0n || amount <= 0n || assets <= 0n) throw new Error("Amounts must be greater than zero.");
      if (role === "buyer" && amount < price) throw new Error("The deposit has to be at least your secret maximum.");
      const id = BigInt(Date.now());
      const next: DealRef = { buyer, seller, id };
      const address = dealAddress(buyer, seller, id, CONFIG);
      const salt = randomSalt();
      const ixs: TransactionInstruction[] = [
        createDealInstruction({
          buyer,
          seller,
          id,
          paymentMint: payment,
          assetMint: asset,
          assetAmount: assets,
          expiryTs: expiryFromNow(Number(expiry)),
          config: CONFIG,
        }),
      ];
      if (role === "buyer") {
        ixs.push(
          ...(await ensureAtas(buyer, [payment])),
          lockBuyerInstruction({
            buyer,
            seller,
            id,
            buyerPayment: associatedTokenAddress(payment, buyer),
            paymentMint: payment,
            commitment: commitment(price, salt),
            amount,
            config: CONFIG,
          }),
        );
      } else {
        ixs.push(
          ...(await ensureAtas(seller, [asset])),
          lockSellerInstruction({
            buyer,
            seller,
            id,
            sellerAsset: associatedTokenAddress(asset, seller),
            assetMint: asset,
            commitment: commitment(price, salt),
            config: CONFIG,
          }),
        );
      }
      const sig = await sendInstructions({ wallet: current.wallet, instructions: ixs, config: CONFIG });
      saveSlip(address.toBase58(), { price, salt });
      writeDealHash(next);
      setRef(next);
      setSignature(sig);
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
      const paymentDecimals = await mintDecimals(conn, deal.paymentMint);
      const price = tokenAmount(secret, paymentDecimals);
      if (price <= 0n) throw new Error("Enter your secret limit.");
      const salt = randomSalt();
      const address = deal.address.toBase58();
      if (yourRole === "buyer") {
        const amount = tokenAmount(deposit.trim() || secret, paymentDecimals);
        if (amount < price) throw new Error("The deposit has to be at least your secret maximum.");
        const ixs = [
          ...(await ensureAtas(current.publicKey, [deal.paymentMint])),
          lockBuyerInstruction({
            buyer: deal.buyer,
            seller: deal.seller,
            id: deal.id,
            buyerPayment: associatedTokenAddress(deal.paymentMint, deal.buyer),
            paymentMint: deal.paymentMint,
            commitment: commitment(price, salt),
            amount,
            config: CONFIG,
          }),
        ];
        const sig = await sendInstructions({ wallet: current.wallet, instructions: ixs, config: CONFIG });
        saveSlip(address, { price, salt });
        setSignature(sig);
      } else {
        const extras = await ensureAtas(current.publicKey, [deal.assetMint]);
        if (extras.length) await sendInstructions({ wallet: current.wallet, instructions: extras, config: CONFIG });
        const sig = await lockSeller({
          wallet: current.wallet,
          buyer: deal.buyer,
          seller: deal.seller,
          id: deal.id,
          sellerAsset: associatedTokenAddress(deal.assetMint, deal.seller),
          assetMint: deal.assetMint,
          commitment: commitment(price, salt),
          config: CONFIG,
        });
        saveSlip(address, { price, salt });
        setSignature(sig);
      }
      await refresh(ref);
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
      const mine = loadSlip(deal.address.toBase58());
      const theirs = theirSlip.trim() ? decodeReveal(theirSlip.trim()) : null;
      if (!mine || !theirs) throw new Error("Settle needs both reveal slips. Paste the other side's slip below.");
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
    setSignature(null);
    setNotice(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "#desk");
  }

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
              {session ? <span className="tag">{session.name}</span> : <span className="tag">Wallet</span>}
            </div>
            <p className="lede" style={{ fontSize: 16 }}>
              Connect a wallet, lock a hash of your price, and share the deal link with the other side.
            </p>
            <p className="quiet">
              Privacy Rings is not connected yet. A settle transaction still carries both prices and salts.
            </p>
            {session ? (
              <div className="row" style={{ marginTop: 16 }}>
                <a className="btn ink" href={explorerAddress(session.publicKey.toBase58())} target="_blank" rel="noreferrer">
                  {shortKey(session.publicKey)}
                </a>
                <button className="btn" type="button" onClick={() => void disconnect()} disabled={busy}>
                  Disconnect
                </button>
              </div>
            ) : wallets.length > 0 ? (
              <div className="wallet-list" style={{ marginTop: 16 }}>
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
            ) : (
              <div className="row" style={{ marginTop: 16 }}>
                <a className="btn ink pressable" href="https://phantom.app/" target="_blank" rel="noreferrer">
                  Install a Solana wallet
                </a>
              </div>
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
          </div>
          <div>
            <Mascot mood={mood} size={140} />
            {!deal && (
              <form className="form" onSubmit={(event) => void onCreate(event)}>
                <div className="row">
                  <button className={role === "buyer" ? "btn small sun" : "btn small"} type="button" onClick={() => setRole("buyer")}>
                    I am the buyer
                  </button>
                  <button className={role === "seller" ? "btn small sun" : "btn small"} type="button" onClick={() => setRole("seller")}>
                    I am the seller
                  </button>
                </div>
                <label className="field">
                  <span>{role === "buyer" ? "Seller wallet" : "Buyer wallet"}</span>
                  <input
                    className="num"
                    value={counterparty}
                    onChange={(event) => setCounterparty(event.target.value)}
                    placeholder="Their wallet"
                    aria-label="Counterparty wallet"
                    autoComplete="off"
                    required
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Payment mint</span>
                    <input
                      className="num"
                      value={paymentMint}
                      onChange={(event) => setPaymentMint(event.target.value)}
                      aria-label="Payment mint"
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Asset mint</span>
                    <input
                      className="num"
                      value={assetMint}
                      onChange={(event) => setAssetMint(event.target.value)}
                      placeholder="Token or NFT mint"
                      aria-label="Asset mint"
                      autoComplete="off"
                      required
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label className="field">
                    <span>Asset amount</span>
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
                <label className="field">
                  <span>{role === "buyer" ? "Your secret maximum" : "Your secret minimum"}</span>
                  <input
                    className="num"
                    inputMode="decimal"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="Stays in this browser until settle"
                    aria-label="Secret limit"
                    required
                  />
                </label>
                {role === "buyer" && (
                  <label className="field">
                    <span>Deposit</span>
                    <input
                      className="num"
                      inputMode="decimal"
                      value={deposit}
                      onChange={(event) => setDeposit(event.target.value)}
                      placeholder="At least your maximum. Public."
                      aria-label="Buyer deposit"
                    />
                  </label>
                )}
                <button className="btn sun pressable" type="submit" disabled={busy || !canAct}>
                  Create and lock
                </button>
                {!session && <p className="quiet">Connect a wallet to send this.</p>}
              </form>
            )}
            {deal && ref && (
              <div className="form">
                <div className="explorer" aria-label="Deal status">
                  <div className="ex-row">
                    <span>status</span>
                    <strong>{statusLabel(deal)}</strong>
                  </div>
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
                      {formatAmount(deal.assetAmount, 0)} · {shortKey(deal.assetMint)}
                    </strong>
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
                <div className="row">
                  <button className="btn small" type="button" onClick={() => void copy("link", dealLink(ref))}>
                    {copied === "link" ? "Link copied" : "Copy deal link"}
                  </button>
                  <a className="btn small" href={explorerAddress(deal.address.toBase58())} target="_blank" rel="noreferrer">
                    Account
                  </a>
                </div>
                {yourRole !== "other" &&
                  !finished &&
                  ((yourRole === "buyer" && !deal.buyerLocked) || (yourRole === "seller" && !deal.sellerLocked)) && (
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
                      {yourRole === "buyer" && (
                        <label className="field">
                          <span>Deposit</span>
                          <input
                            className="num"
                            inputMode="decimal"
                            value={deposit}
                            onChange={(event) => setDeposit(event.target.value)}
                            aria-label="Buyer deposit"
                          />
                        </label>
                      )}
                      <button className="btn sun pressable" type="button" disabled={busy || !canAct} onClick={() => void onLock()}>
                        Lock my price
                      </button>
                    </>
                  )}
                {ownSlip && (
                  <label className="field">
                    <span>Your reveal slip</span>
                    <textarea className="area" readOnly value={ownSlip} aria-label="Your reveal slip" />
                    <button className="btn small" type="button" onClick={() => void copy("slip", ownSlip)}>
                      {copied === "slip" ? "Slip copied" : "Copy slip"}
                    </button>
                    <p className="quiet">Send this to the other side out of band. Settle needs both slips.</p>
                  </label>
                )}
                {bothLocked && !finished && (
                  <>
                    <label className="field">
                      <span>Their reveal slip</span>
                      <textarea
                        className="area"
                        value={theirSlip}
                        onChange={(event) => setTheirSlip(event.target.value)}
                        placeholder="Paste the slip they sent you"
                        aria-label="Their reveal slip"
                      />
                    </label>
                    <button
                      className="btn sun pressable"
                      type="button"
                      disabled={busy || !canAct || !ownSlip}
                      onClick={() => void onSettle()}
                    >
                      Settle
                    </button>
                  </>
                )}
                <div className="row">
                  {deal.status === "open" && !bothLocked && yourRole !== "other" && (
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
