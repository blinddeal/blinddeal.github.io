import { useId, useLayoutEffect, useRef } from "react";
import gsap from "gsap";

export type Mood = "idle" | "lock" | "match" | "deal" | "nodeal" | "error" | "loading";

const ink = "#181818";
const gold = "#f8c641";
const paper = "#fffbf3";
const shadow = "#e4d7c4";

const VB_W = 800;
const VB_H = 604;

export function Mascot({ mood, size = 160 }: { mood: Mood; size?: number }) {
  const root = useRef<SVGSVGElement>(null);
  const clipId = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context(() => {
      svg.querySelectorAll<SVGGElement>("[data-show]").forEach((node) => {
        const on = node.dataset.show?.split(" ").includes(mood) ?? false;
        gsap.to(node, {
          autoAlpha: on ? 1 : 0,
          duration: reduce ? 0 : 0.32,
          ease: "power2.out",
          overwrite: "auto",
        });
      });
      if (reduce) return;
      const bob = svg.querySelector(".bob");
      if (mood === "idle") {
        gsap.to(bob, { y: -6, duration: 1.8, ease: "sine.inOut", yoyo: true, repeat: -1 });
        gsap.to(".eye-idle", {
          scaleY: 0.14,
          transformOrigin: "50% 50%",
          duration: 0.09,
          yoyo: true,
          repeat: 1,
          repeatDelay: 2.8,
          delay: 1.2,
        });
      }
      if (mood === "lock") {
        gsap.fromTo(".lock-arm", { x: -12 }, { x: 0, duration: 0.4, ease: "power2.out" });
        gsap.fromTo(".motion", { x: -4 }, { x: 3, duration: 0.16, yoyo: true, repeat: 3, ease: "power1.inOut" });
      }
      if (mood === "match") {
        gsap.fromTo(".spark", { scale: 0.3, rotation: -18, transformOrigin: "50% 50%" }, { scale: 1, rotation: 0, duration: 0.4, ease: "power2.out" });
      }
      if (mood === "deal") {
        gsap.fromTo(bob, { y: 8 }, { y: -10, duration: 0.4, ease: "power2.out" });
        gsap.fromTo(".confetti", { y: 10, autoAlpha: 0 }, { y: -14, autoAlpha: 1, duration: 0.45, stagger: 0.04, ease: "power2.out" });
      }
      if (mood === "nodeal") {
        gsap.fromTo(".shrug", { y: 8 }, { y: 0, duration: 0.36, ease: "power2.out" });
      }
      if (mood === "error") {
        gsap.fromTo(bob, { rotation: 0 }, { rotation: -3.5, transformOrigin: "50% 80%", duration: 0.32, ease: "power2.out" });
        gsap.fromTo(".mark", { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.28, ease: "power2.out" });
      }
      if (mood === "loading") {
        gsap.to(".watch-hand", { rotation: 360, transformOrigin: "0px 0px", duration: 1.8, repeat: -1, ease: "none" });
        gsap.to(bob, { y: -4, duration: 1.3, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    }, svg);
    return () => ctx.revert();
  }, [mood]);

  return (
    <svg
      ref={root}
      className="mascot"
      data-mood={mood}
      width={size}
      height={Math.round((size * VB_H) / VB_W)}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label={labelFor(mood)}
    >
      <ellipse cx="400" cy="528" rx="156" ry="13" fill={shadow} />
      <g className="bob">
        <defs>
          <clipPath id={clipId}>
            <rect x="122" y="78" width="555" height="414" rx="108" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x="122" y="78" width="555" height="414" rx="108" fill={paper} />
          <path d="M90 130 L400 300 L710 130 L710 40 L90 40 Z" fill={gold} />
        </g>
        <rect x="122" y="78" width="555" height="414" rx="108" fill="none" stroke={ink} strokeWidth="11" />
        <path d="M132 152 L400 308 L668 152" fill="none" stroke={ink} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M368 250 v-16 a32 32 0 0 1 64 0 v16" fill={paper} stroke={ink} strokeWidth="10" strokeLinejoin="round" />
        <rect x="349" y="244" width="102" height="92" rx="18" fill={gold} stroke={ink} strokeWidth="10" />
        <circle cx="400" cy="280" r="8" fill={ink} />
        <path d="M395 286 h10 l-5 16 z" fill={ink} />
        <rect x="239" y="476" width="82" height="34" rx="17" fill={ink} />
        <rect x="479" y="476" width="82" height="34" rx="17" fill={ink} />
        <g data-show="idle lock loading">
          <circle className="eye-idle" cx="296" cy="364" r="14" fill={ink} />
          <circle className="eye-idle" cx="503" cy="364" r="14" fill={ink} />
          <path d="M322 416 H478" fill="none" stroke={ink} strokeWidth="10" strokeLinecap="round" />
        </g>
        <g data-show="match" opacity="0">
          <circle cx="296" cy="364" r="14" fill={ink} />
          <circle cx="503" cy="364" r="14" fill={ink} />
          <path d="M368 398 q24 14 42 -4" fill="none" stroke={ink} strokeWidth="10" strokeLinecap="round" />
        </g>
        <g data-show="deal" opacity="0">
          <path d="M278 370 q18 -20 34 0" fill="none" stroke={ink} strokeWidth="11" strokeLinecap="round" />
          <path d="M488 370 q18 -20 34 0" fill="none" stroke={ink} strokeWidth="11" strokeLinecap="round" />
          <path d="M352 400 q48 70 96 0 q-48 18 -96 0 z" fill={paper} stroke={ink} strokeWidth="10" strokeLinejoin="round" />
        </g>
        <g data-show="nodeal" opacity="0">
          <path d="M282 372 q16 -14 30 0" fill="none" stroke={ink} strokeWidth="11" strokeLinecap="round" />
          <path d="M488 372 q16 -14 30 0" fill="none" stroke={ink} strokeWidth="11" strokeLinecap="round" />
          <path d="M368 412 q32 20 64 0" fill="none" stroke={ink} strokeWidth="10" strokeLinecap="round" />
        </g>
        <g data-show="error" opacity="0">
          <circle cx="296" cy="368" r="15" fill={ink} />
          <circle cx="503" cy="368" r="15" fill={ink} />
          <path d="M352 432 q48 -26 96 0" fill="none" stroke={ink} strokeWidth="10" strokeLinecap="round" />
        </g>
        <g className="lock-arm" data-show="lock" opacity="0">
          <path className="motion" d="M458 228 l22 -16 M472 246 l26 -6" fill="none" stroke={ink} strokeWidth="8" strokeLinecap="round" />
          <path d="M210 360 C250 348 290 332 328 318" fill="none" stroke={ink} strokeWidth="44" strokeLinecap="round" />
          <path d="M210 360 C250 348 290 332 328 318" fill="none" stroke={paper} strokeWidth="28" strokeLinecap="round" />
          <path d="M286 314 C308 278 342 270 346 304" fill="none" stroke={ink} strokeWidth="26" strokeLinecap="round" />
          <path d="M286 314 C308 278 342 270 346 304" fill="none" stroke={paper} strokeWidth="12" strokeLinecap="round" />
        </g>
        <g data-show="match" opacity="0">
          <path d="M392 458 L354 392" fill="none" stroke={ink} strokeWidth="24" strokeLinecap="round" />
          <path d="M392 458 L354 392" fill="none" stroke={paper} strokeWidth="12" strokeLinecap="round" />
          <ellipse cx="404" cy="468" rx="40" ry="26" fill={paper} stroke={ink} strokeWidth="9" />
          <path d="M424 452 C456 432 486 456 468 488" fill="none" stroke={ink} strokeWidth="22" strokeLinecap="round" />
          <path d="M424 452 C456 432 486 456 468 488" fill="none" stroke={paper} strokeWidth="10" strokeLinecap="round" />
          <path className="spark" d="M724 42 l8 18 18 8 -18 8 -8 18 -8 -18 -18 -8 18 -8 z" fill={gold} stroke={ink} strokeWidth="5" strokeLinejoin="round" />
        </g>
        <g data-show="deal" opacity="0">
          <path d="M176 270 C104 250 74 166 116 122 C148 90 192 112 188 158 C184 202 210 248 194 288 C186 304 182 286 176 270 Z" fill={paper} stroke={ink} strokeWidth="9" strokeLinejoin="round" />
          <path d="M624 270 C696 250 726 166 684 122 C652 90 608 112 612 158 C616 202 590 248 606 288 C614 304 618 286 624 270 Z" fill={paper} stroke={ink} strokeWidth="9" strokeLinejoin="round" />
          <g className="confetti" fill={gold}>
            <rect x="68" y="148" width="28" height="14" rx="4" transform="rotate(-32 82 155)" />
            <rect x="128" y="72" width="22" height="12" rx="4" transform="rotate(18 139 78)" />
            <rect x="52" y="228" width="20" height="12" rx="4" transform="rotate(12 62 234)" />
            <rect x="690" y="128" width="28" height="14" rx="4" transform="rotate(26 704 135)" />
            <rect x="736" y="198" width="22" height="12" rx="4" transform="rotate(-18 747 204)" />
            <rect x="646" y="58" width="20" height="12" rx="4" transform="rotate(-22 656 64)" />
          </g>
        </g>
        <g className="shrug" data-show="nodeal" opacity="0">
          <path d="M158 308 C84 288 48 336 66 394 C80 440 150 434 166 376 C176 342 178 322 158 308 Z" fill={paper} stroke={ink} strokeWidth="9" strokeLinejoin="round" />
          <path d="M642 308 C716 288 752 336 734 394 C720 440 650 434 634 376 C624 342 622 322 642 308 Z" fill={paper} stroke={ink} strokeWidth="9" strokeLinejoin="round" />
        </g>
        <g data-show="error" opacity="0">
          <g className="mark">
            <path d="M108 86c0-20 2-24 20-34 16-9 26-18 26-34 0-22-16-36-40-36-24 0-40 16-40 36" fill="none" stroke={ink} strokeWidth="12" strokeLinecap="round" />
            <circle cx="74" cy="108" r="6.5" fill={ink} />
          </g>
        </g>
        <g data-show="loading" opacity="0">
          <g transform="translate(688 430)">
            <circle r="32" fill={paper} stroke={ink} strokeWidth="9" />
            <path d="M-12 -40 h8 M4 -40 h8" stroke={ink} strokeWidth="8" strokeLinecap="round" />
            <path d="M-6 -38 h12" stroke={ink} strokeWidth="9" strokeLinecap="round" />
            <g className="watch-hand">
              <path d="M0 0 L-8 -16" stroke={ink} strokeWidth="5" strokeLinecap="round" />
              <path d="M0 0 L10 -2" stroke={ink} strokeWidth="5" strokeLinecap="round" />
              <circle r="4" fill={ink} />
            </g>
            <path d="M18 6 C46 -8 82 16 74 52 C68 82 32 78 22 46 C16 28 12 16 18 6 Z" fill={paper} stroke={ink} strokeWidth="9" strokeLinejoin="round" />
          </g>
        </g>
      </g>
    </svg>
  );
}

function labelFor(mood: Mood) {
  if (mood === "deal") return "BlindDeal mascot celebrating a deal";
  if (mood === "nodeal") return "BlindDeal mascot shrugging, no deal";
  if (mood === "lock") return "BlindDeal mascot locking the envelope";
  if (mood === "match") return "BlindDeal mascot thinking through a match";
  if (mood === "error") return "BlindDeal mascot confused";
  if (mood === "loading") return "BlindDeal mascot waiting";
  return "BlindDeal mascot, a sealed envelope";
}
