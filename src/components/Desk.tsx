import { useState } from "react";
import { currentShot } from "../shot";
import { Mascot } from "./Mascot";
import { Window } from "./Window";

const forced = currentShot() === "error";

export function Desk() {
  const [missed, setMissed] = useState(forced);

  return (
    <section id="desk">
      <p className="kicker">Open a deal</p>
      <Window title="Escrow">
        <div className="split">
          <div>
            <div className="row">
              <span className="tag sun">Localnet</span>
              <span className="tag">Devnet</span>
            </div>
            <p className="lede" style={{ fontSize: 16 }}>
              Lock a hash of your price into the BlindDeal program. The account stores the commitment, not the number.
            </p>
            <p className="quiet">
              When you settle, the prices still appear in that transaction. Private balances are not connected yet.
            </p>
            {missed && (
              <p className="note" role="status">
                No wallet in this browser. You can still try a deal above. A funded wallet is needed to lock for real.
              </p>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn ink pressable" type="button" onClick={() => setMissed(true)}>
                Connect wallet
              </button>
              <a className="btn" href="#demo">
                Try a deal first
              </a>
            </div>
          </div>
          <div>
            <Mascot mood={missed ? "error" : "idle"} size={140} />
            <form className="form" onSubmit={(event) => event.preventDefault()}>
              <div className="form-grid">
                <label className="field">
                  <span>Counterparty</span>
                  <input className="num" placeholder="Their wallet" aria-label="Counterparty wallet" />
                </label>
                <label className="field">
                  <span>Asset amount</span>
                  <input className="num" inputMode="decimal" placeholder="1" aria-label="Asset amount" />
                </label>
              </div>
              <label className="field">
                <span>Your secret limit</span>
                <input className="num" inputMode="numeric" placeholder="Stays in this browser until settle" aria-label="Secret limit" />
              </label>
              <button className="btn" type="submit" disabled>
                Create deal after connect
              </button>
            </form>
          </div>
        </div>
      </Window>
    </section>
  );
}
