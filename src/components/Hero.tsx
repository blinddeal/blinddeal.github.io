import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Mascot } from "./Mascot";
import { Window } from "./Window";

const pitch =
  "Negotiate without showing your hand. A deal only happens if your prices overlap — and if they don't, nobody learns anything.";

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const [line, setLine] = useState(pitch);
  const [slot, setSlot] = useState(312_448_901);

  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const node = root.current;
    if (!node || reduce) return;
    const ctx = gsap.context(() => {
      gsap.from(node.querySelector(".window"), {
        autoAlpha: 0,
        y: 16,
        scale: 0.985,
        duration: 0.6,
        ease: "power2.out",
        transformOrigin: "50% 0%",
      });
      gsap.from(node.querySelectorAll("[data-stagger]"), {
        autoAlpha: 0,
        y: 10,
        duration: 0.45,
        stagger: 0.06,
        delay: 0.12,
        ease: "power2.out",
      });
    }, node);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const alphabet = "0123456789abcdef";
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      const cut = Math.floor((frame / 28) * pitch.length);
      setLine(
        pitch
          .split("")
          .map((char, index) => {
            if (char === " ") return " ";
            if (index < cut) return pitch[index];
            return alphabet[Math.floor(Math.random() * alphabet.length)];
          })
          .join(""),
      );
      if (frame >= 28) window.clearInterval(timer);
    }, 34);
    const slotTimer = window.setInterval(() => {
      setSlot((value) => value + 1);
    }, 1400);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(slotTimer);
    };
  }, []);

  return (
    <section id="hero" ref={root}>
      <Window title="BlindDeal">
        <div className="hero-grid">
          <div>
            <h1 className="display" data-stagger>
              BlindDeal
            </h1>
            <p className="lede" data-stagger>
              Two people lock a secret price. The deal clears only if those prices meet.
            </p>
            <div className="cipher mono" data-stagger aria-live="polite">
              {line}
            </div>
            <div className="row" style={{ marginTop: 18 }} data-stagger>
              <a className="btn sun pressable" href="#demo">
                Try a deal
              </a>
              <a className="btn pressable" href="#how">
                How it works
              </a>
            </div>
            <div className="status-line mono" aria-hidden="true">
              <span>slot {slot.toLocaleString("en-US")}</span>
              <span>limits ●●●●</span>
            </div>
          </div>
          <div className="hero-mascot" data-stagger>
            <Mascot mood="idle" size={210} />
          </div>
        </div>
      </Window>
    </section>
  );
}
