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
