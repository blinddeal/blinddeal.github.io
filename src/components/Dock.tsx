import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";

const items = [
  { id: "hero", label: "Home" },
  { id: "desk", label: "Deal" },
  { id: "how", label: "How" },
  { id: "why", label: "Uses" },
  { id: "tech", label: "Tech" },
];

const COLLAPSE_AFTER = 18;
const EXPAND_AFTER = 12;
const TOP_EDGE = 32;
const BOTTOM_EDGE = 64;
const MORPH = 0.46;
const EASE = "power3.inOut";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function metrics() {
  const narrow = window.matchMedia("(max-width: 599px)").matches;
  const itemW = narrow ? 52 : 64;
  const itemH = narrow ? 52 : 58;
  const pad = narrow ? 4 : 6;
  const compactPad = narrow ? 3 : 4;
  const compactItemH = narrow ? 48 : 52;
  const border = 2;
  const count = items.length;
  return {
    itemW,
    itemH,
    pad,
    compactPad,
    compactItemH,
    fullW: pad * 2 + itemW * count + border * 2,
    fullH: pad * 2 + itemH + border * 2,
    compactW: compactPad * 2 + itemW + border * 2,
    compactH: compactPad * 2 + compactItemH + border * 2,
  };
}

function pillSpot(active: HTMLElement) {
  const size = Math.round(Math.min(active.offsetWidth, active.offsetHeight) - 8);
  if (size <= 0) return null;
  return {
    x: active.offsetLeft + (active.offsetWidth - size) / 2,
    y: active.offsetTop + (active.offsetHeight - size) / 2,
    width: size,
    height: size,
  };
}

export function Dock() {
  const [current, setCurrent] = useState("hero");
  const [folded, setFolded] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const foldedRef = useRef(false);
  const placed = useRef(false);
  const morphing = useRef<gsap.core.Timeline | null>(null);
  const lastY = useRef(0);
  const accum = useRef(0);

  const placePill = (animate: boolean) => {
    const pill = pillRef.current;
    const dock = dockRef.current;
    const active = dock?.querySelector<HTMLElement>("[aria-current='true']");
    if (!pill || !active) return;
    const spot = pillSpot(active);
    if (!spot) return;
    if (!placed.current || reducedMotion() || !animate) {
      gsap.set(pill, spot);
      placed.current = true;
      return;
    }
    gsap.to(pill, { ...spot, duration: 0.32, ease: "power2.out", overwrite: "auto" });
  };

  const applyLayout = (nextFolded: boolean, animate: boolean) => {
    const dock = dockRef.current;
    if (!dock) return;
    const links = Array.from(dock.querySelectorAll<HTMLElement>(":scope > a"));
    const active = links.find((link) => link.getAttribute("aria-current") === "true") ?? links[0];
    const m = metrics();
    const duration = animate && !reducedMotion() ? MORPH : 0;
    morphing.current?.kill();
    const tl = gsap.timeline({
      defaults: { duration, ease: EASE, overwrite: "auto" },
      onUpdate: () => placePill(false),
      onComplete: () => placePill(false),
    });
    morphing.current = tl;
    tl.to(
      dock,
      {
        width: nextFolded ? m.compactW : m.fullW,
        height: nextFolded ? m.compactH : m.fullH,
        paddingTop: nextFolded ? m.compactPad : m.pad,
        paddingRight: nextFolded ? m.compactPad : m.pad,
        paddingBottom: nextFolded ? m.compactPad : m.pad,
        paddingLeft: nextFolded ? m.compactPad : m.pad,
        borderRadius: 999,
      },
      0,
    );
    for (const link of links) {
      const on = !nextFolded || link === active;
      const height = nextFolded ? m.compactItemH : m.itemH;
      const padY = nextFolded ? 3 : m.itemH === 58 ? 6 : 4;
      const padX = nextFolded ? 2 : m.itemW === 64 ? 4 : 2;
      tl.to(
        link,
        {
          width: on ? m.itemW : 0,
          minWidth: on ? m.itemW : 0,
          maxWidth: on ? m.itemW : 0,
          height: on ? height : height,
          minHeight: on ? height : height,
          paddingTop: on ? padY : 0,
          paddingBottom: on ? padY : 0,
          paddingLeft: on ? padX : 0,
          paddingRight: on ? padX : 0,
          autoAlpha: on ? 1 : 0,
        },
        0,
      );
      link.setAttribute("aria-hidden", on ? "false" : "true");
      link.tabIndex = on ? 0 : -1;
    }
  };

  const setFoldedState = (next: boolean, animate = true) => {
    if (foldedRef.current === next) return;
    foldedRef.current = next;
    setFolded(next);
    applyLayout(next, animate);
  };

  useLayoutEffect(() => {
    applyLayout(foldedRef.current, false);
    placePill(false);
  }, [current]);

  useEffect(() => {
    const onResize = () => {
      applyLayout(foldedRef.current, false);
      placePill(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const dy = y - lastY.current;
      lastY.current = y;
      if (y <= TOP_EDGE || (max > 0 && y >= max - BOTTOM_EDGE)) {
        accum.current = 0;
        setFoldedState(false);
        return;
      }
      if (dy === 0) return;
      if (dy > 0) {
        accum.current = accum.current < 0 ? dy : accum.current + dy;
        if (accum.current >= COLLAPSE_AFTER) {
          accum.current = 0;
          setFoldedState(true);
        }
      } else {
        accum.current = accum.current > 0 ? dy : accum.current + dy;
        if (accum.current <= -EXPAND_AFTER) {
          accum.current = 0;
          setFoldedState(false);
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const syncCurrent = () => {
      const probe = window.innerHeight * 0.42;
      let best = items[0].id;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const item of items) {
        const node = document.getElementById(item.id);
        if (!node) continue;
        const box = node.getBoundingClientRect();
        if (box.top <= probe && box.bottom > probe) {
          best = item.id;
          bestDist = 0;
          break;
        }
        const dist = box.bottom < probe ? probe - box.bottom : box.top - probe;
        if (dist < bestDist) {
          bestDist = dist;
          best = item.id;
        }
      }
      setCurrent((prev) => (prev === best ? prev : best));
    };
    syncCurrent();
    window.addEventListener("scroll", syncCurrent, { passive: true });
    window.addEventListener("resize", syncCurrent);
    return () => {
      window.removeEventListener("scroll", syncCurrent);
      window.removeEventListener("resize", syncCurrent);
    };
  }, []);

  return createPortal(
    <>
      <div className="dock-veil" aria-hidden="true" />
      <nav
        className={folded ? "dock is-compact" : "dock"}
        aria-label="Sections"
        data-compact={folded ? "true" : "false"}
        ref={dockRef}
        onClick={() => {
          if (foldedRef.current) setFoldedState(false);
        }}
      >
        <span className="dock-pill" ref={pillRef} aria-hidden="true" />
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={current === item.id}
            className={item.id === "hero" ? "pressable" : undefined}
            onClick={(event) => {
              if (foldedRef.current) {
                event.preventDefault();
                event.stopPropagation();
                setFoldedState(false);
                return;
              }
              setCurrent(item.id);
            }}
          >
            <Icon name={item.id} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </>,
    document.body,
  );
}

function Icon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", "aria-hidden": true as const };
  if (name === "hero") {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="14" height="12" rx="3" stroke="#1c1c1c" strokeWidth="1.7" />
        <path d="M4 7h10M4 10h6" stroke="#1c1c1c" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "desk") {
    return (
      <svg {...common}>
        <rect x="3" y="2" width="12" height="10" rx="2" stroke="#1c1c1c" strokeWidth="1.7" />
        <path d="M2 15h14" stroke="#1c1c1c" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "how") {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="6.2" stroke="#1c1c1c" strokeWidth="1.7" />
        <path d="M9 8v4M9 5.5v.5" stroke="#1c1c1c" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "why") {
    return (
      <svg {...common}>
        <path d="M3 13V5h5l1 2h6v6H3z" stroke="#1c1c1c" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 5h10v8H4z" stroke="#1c1c1c" strokeWidth="1.7" />
      <path d="M6 8h3M6 11h6" stroke="#1c1c1c" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
