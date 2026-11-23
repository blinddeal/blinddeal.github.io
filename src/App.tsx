import { useLayoutEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Desk } from "./components/Desk";
import { Dock } from "./components/Dock";
import { Hero } from "./components/Hero";
import { Footer, How, Tech, Why } from "./components/Story";
import { currentShot } from "./shot";

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  useLayoutEffect(() => {
    document.body.dataset.shot = currentShot() ?? "";
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set("[data-reveal]", { autoAlpha: 1, y: 0 });
    });
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.from(el, {
          autoAlpha: 0,
          y: 16,
          duration: 0.55,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
    });
    const goDesk = () => {
      const hash = window.location.hash.replace("#", "").split("?")[0];
      const fromQuery = new URLSearchParams(window.location.search).has("d");
      if (hash === "desk" || hash.startsWith("/d/") || hash.startsWith("d/") || fromQuery) {
        document.getElementById("desk")?.scrollIntoView();
        return;
      }
      if (hash) document.getElementById(hash)?.scrollIntoView();
    };
    window.setTimeout(goDesk, 40);
    window.addEventListener("hashchange", goDesk);
    return () => {
      window.removeEventListener("hashchange", goDesk);
      mm.revert();
    };
  }, []);

  return (
    <>
      <a className="skip" href="#desk">
        Skip to open a deal
      </a>
      <main className="page">
        <Hero />
        <div data-reveal>
          <Desk />
        </div>
        <div data-reveal>
          <How />
        </div>
        <div data-reveal>
          <Why />
        </div>
        <div data-reveal>
          <Tech />
        </div>
        <Footer />
      </main>
      <Dock />
    </>
  );
}
