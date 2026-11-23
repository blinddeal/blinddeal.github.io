import { Window } from "./Window";

const steps = [
  ["01", "Set a price", "Each side types a secret number. Only you see yours."],
  ["02", "Send the link", "Share it with the other person. They set their price the same way."],
  ["03", "Meet or walk", "If the prices overlap, you meet in the middle. If they miss, both walk away and nobody sees a number."],
  ["04", "Finish", "A match pays the midpoint and returns the rest. A miss refunds both. Your number is not stored on the deal itself."],
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
            matcher on-device prices
            <br />
            account stores no price
            <br />
            rings private compare none
          </div>
          <div>
            <p className="quiet" style={{ marginTop: 0 }}>
              Right now each price stays secret on this device. The deal account does not store the number. When you settle, those prices still appear in the transaction. Private comparison with Helius Privacy Rings is not connected yet.
            </p>
            <div className="road" style={{ marginTop: 14 }}>
              <span className="tag sun">Now · secret prices</span>
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
    <footer className="site-foot">
      <p className="foot-title">Follow the build</p>
      <p>Your number stays yours.</p>
      <p>
        <a href="https://github.com/nirempathys" target="_blank" rel="noreferrer">
          Follow @nirempathys
        </a>
      </p>
      <p>Made on Solana, for the Helius Privacy Rings</p>
    </footer>
  );
}
