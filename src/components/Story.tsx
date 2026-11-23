import { Window } from "./Window";

const steps = [
  ["01", "Lock", "The buyer locks funds as a ceiling. The seller locks the asset and a minimum."],
  ["02", "Seal", "Each limit is a hash plus a secret salt. The deposit everyone can see is only an upper bound."],
  ["03", "Match", "The program checks one thing: is the max at least the min? The proofs bind the vault, so a matcher cannot redirect it."],
  ["04", "Settle", "Overlap pays the floored midpoint and returns the rest. A miss refunds both. Raw limits are not written onto the account."],
];

const cases = [
  ["OTC", "Trade a token or NFT without posting the bid in public first."],
  ["P2P", "Swap only when both sides can live with the number."],
  ["Freelance", "A client max and a freelancer floor. The contract price is the midpoint, or there is no number to argue about."],
  ["Salary", "Each side commits a bound. A miss does not leave an anchor in the open."],
];

export function How() {
  return (
    <section id="how">
      <p className="kicker">How it works</p>
      <Window title="Four steps">
        <div className="steps">
          {steps.map(([index, title, body]) => (
            <article className="step" key={index}>
              <div className="idx">{index}</div>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </Window>
    </section>
  );
}

export function Why() {
  return (
    <section id="why">
      <p className="kicker">Where it fits</p>
      <Window title="Uses">
        <div className="case-grid">
          {cases.map(([title, body]) => (
            <article className="case" key={title}>
              <div className="idx">{title.slice(0, 1)}</div>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </Window>
    </section>
  );
}

export function Tech() {
  return (
    <section id="tech">
      <p className="kicker">What's live</p>
      <Window title="Status">
        <div className="split">
          <div className="note mono">
            program blind_deal
            <br />
            matcher clear-reveal
            <br />
            account stores hash, not price
            <br />
            rings private compare none
          </div>
          <div>
            <p className="quiet" style={{ marginTop: 0 }}>
              Right now each price is a hash commitment. The deal account stores the hash, not the number. When you settle, those prices still appear in the transaction. Private comparison with Helius Privacy Rings is not connected yet.
            </p>
            <div className="road" style={{ marginTop: 14 }}>
              <span className="tag sun">Now · hash commitments</span>
              <span className="tag">Next · TEE or MPC compare</span>
              <span className="tag">Later · an agent that locks your band</span>
            </div>
          </div>
        </div>
      </Window>
    </section>
  );
}

export function Footer() {
  return (
    <section id="footer">
      <Window title="Follow the build">
        <h2 className="display" style={{ fontSize: "clamp(32px, 5vw, 48px)" }}>
          Your number stays yours.
        </h2>
        <p className="quiet">Made on Solana, for the Helius Privacy Rings hackathon.</p>
        <div className="row" style={{ marginTop: 16 }}>
          <a className="btn ink pressable" href="https://github.com/nirempathys" target="_blank" rel="noreferrer">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
            </svg>
            Follow @nirempathys
          </a>
        </div>
      </Window>
    </section>
  );
}
