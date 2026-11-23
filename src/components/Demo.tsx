import { useRef, useState } from "react";
import gsap from "gsap";
import { formatUnits, midpoint, overlaps } from "../match";
import { currentShot } from "../shot";
import { Mascot, type Mood } from "./Mascot";
import { Window } from "./Window";

type Phase = "edit" | "lock" | "match" | "deal" | "nodeal";

const shot = currentShot();

function initialPhase(): Phase {
  if (shot === "deal") return "deal";
  if (shot === "nodeal") return "nodeal";
  if (shot === "lock" || shot === "loading") return "lock";
  if (shot === "match") return "match";
  return "edit";
}

export function Demo() {
  const miss = shot === "nodeal";
  const [buyerMax, setBuyerMax] = useState(miss ? 800 : 1500);
  const [sellerMin, setSellerMin] = useState(miss ? 1400 : 900);
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [sig] = useState(() => fakeSig(miss ? 2 : 1));
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const sealed = phase !== "edit";
  const showDeal = phase === "deal";
  const showMiss = phase === "nodeal";
  const price = midpoint(buyerMax, sellerMin);

  function lock() {
    const hit = overlaps(buyerMax, sellerMin);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timeline.current?.kill();
    if (reduce) {
      setPhase(hit ? "deal" : "nodeal");
      return;
    }
    setPhase("lock");
    timeline.current = gsap.timeline();
    timeline.current.call(() => setPhase("match"), [], 0.7);
    timeline.current.call(() => setPhase(hit ? "deal" : "nodeal"), [], 1.45);
  }

  const mood: Mood =
    phase === "deal" ? "deal" : phase === "nodeal" ? "nodeal" : phase === "match" ? "match" : phase === "lock" ? "lock" : "idle";

  return (
    <section id="demo">
      <p className="kicker">Try a deal</p>
      <Window title="Blind match">
        <div className="banner">
          <span>Try it here in the browser. Nothing is signed or sent onchain.</span>
          <span className="tag">Not mainnet</span>
        </div>
        <div className="party-grid">
          <Party
            title="Buyer"
            label="Maximum you will pay"
            value={buyerMax}
            min={100}
            max={5000}
            sealed={sealed}
            disabled={phase !== "edit"}
            onChange={setBuyerMax}
          />
          <Party
            title="Seller"
            label="Minimum you will accept"
            value={sellerMin}
            min={100}
            max={5000}
            sealed={sealed}
            disabled={phase !== "edit"}
            onChange={setSellerMin}
          />
        </div>
        {phase === "edit" ? (
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn small" type="button" onClick={() => { setBuyerMax(1500); setSellerMin(900); }}>
              They overlap
            </button>
            <button className="btn small" type="button" onClick={() => { setBuyerMax(800); setSellerMin(1400); }}>
              They miss
            </button>
            <button className="btn sun pressable" type="button" onClick={lock}>
              Lock & match
            </button>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                timeline.current?.kill();
                setPhase("edit");
              }}
            >
              New negotiation
            </button>
          </div>
        )}
        <div className="outcome" style={{ marginTop: 22 }} aria-live="polite">
          <Mascot mood={shot === "loading" ? "loading" : mood} size={120} />
          <div>
            {phase === "edit" && (
              <>
                <h3>Set both limits</h3>
                <p className="quiet">A deal happens if the buyer max is at least the seller min. The price is the midpoint.</p>
              </>
            )}
            {phase === "lock" && (
              <>
                <h3>Sealing</h3>
                <p className="mono">commit {scramble(buyerMax)} · {scramble(sellerMin)}</p>
              </>
            )}
            {phase === "match" && (
              <>
                <h3>Matching</h3>
                <p className="quiet">One question: do the sealed ranges overlap?</p>
              </>
            )}
            {showDeal && (
              <>
                <h3>Deal @ {formatUnits(price)} USDC</h3>
                <p className="quiet">Only the midpoint is published. Each limit stays sealed.</p>
              </>
            )}
            {showMiss && (
              <>
                <h3>NO DEAL</h3>
                <p className="quiet">Both sides are refunded. Neither limit is shown.</p>
              </>
            )}
          </div>
        </div>
        {(showDeal || showMiss || phase === "match" || phase === "lock") && (
          <div className="explorer" aria-label="Preview explorer">
            <div className="ex-row"><span>status</span><strong>{showDeal || showMiss ? "confirmed · preview" : "pending · preview"}</strong></div>
            <div className="ex-row"><span>outcome</span><strong>{showDeal ? "DEAL" : showMiss ? "NO DEAL" : "…"}</strong></div>
            {showDeal && (
              <div className="ex-row"><span>clearing price</span><strong>{formatUnits(price)} USDC</strong></div>
            )}
            <div className="ex-row"><span>buyer limit</span><strong>●●●●</strong></div>
            <div className="ex-row"><span>seller limit</span><strong>●●●●</strong></div>
            <div className="ex-row"><span>asset</span><strong>●●●●</strong></div>
            <div className="ex-row"><span>signature</span><strong>{sig}</strong></div>
            <p className="quiet">This panel is a preview, not a real transaction.</p>
          </div>
        )}
      </Window>
    </section>
  );
}

function Party({
  title,
  label,
  value,
  min,
  max,
  sealed,
  disabled,
  onChange,
}: {
  title: string;
  label: string;
  value: number;
  min: number;
  max: number;
  sealed: boolean;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const id = title.toLowerCase();
  return (
    <div className="field">
      <span>{title}</span>
      <label htmlFor={id}>{label}</label>
      {sealed ? (
        <div className="sealed" aria-label={`${title} limit sealed`}>●●●●</div>
      ) : (
        <>
          <input
            id={id}
            className="slider"
            type="range"
            min={min}
            max={max}
            step={10}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <input
            className="num"
            type="number"
            min={min}
            max={max}
            value={value}
            aria-label={`${title} amount in USDC`}
            disabled={disabled}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
            }}
          />
        </>
      )}
    </div>
  );
}

function scramble(seed: number) {
  const alphabet = "abcdef0123456789";
  let out = "";
  let n = seed * 17 + 9;
  for (let i = 0; i < 8; i += 1) {
    n = (n * 33 + 7) % alphabet.length;
    out += alphabet[n];
  }
  return out;
}

function fakeSig(seed: number) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = seed * 997;
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    n = (n * 31 + 11) % alphabet.length;
    out += alphabet[n];
  }
  return `${out}…`;
}
