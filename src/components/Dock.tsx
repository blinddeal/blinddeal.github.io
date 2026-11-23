import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Observer } from "gsap/Observer";

gsap.registerPlugin(Observer);

const items = [
  { id: "hero", label: "Home" },
  { id: "desk", label: "Deal" },
  { id: "how", label: "How" },
  { id: "why", label: "Uses" },
  { id: "tech", label: "Tech" },
];

const COLLAPSE_AFTER = 14;
const EXPAND_AFTER = 12;
const TOP_EDGE = 32;
const BOTTOM_EDGE = 64;
const MORPH = 0.42;
const EASE = "power2.inOut";
const INK = "#1c1c1c";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isRootScroller(node: EventTarget | null) {
  return (
    node === window ||
    node === document ||
    node === document.documentElement ||
    node === document.body ||
    node === document.scrollingElement
  );
}

function rootScrollY() {
  const se = document.scrollingElement;
  const page = document.querySelector("main.page") || document.getElementById("root") || document.body;
  const fromBox = page instanceof HTMLElement ? Math.round(-page.getBoundingClientRect().top) : 0;
  return Math.max(
    window.scrollY || 0,
    window.pageYOffset || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0,
    se ? se.scrollTop : 0,
    fromBox,
    0,
  );
}

function rootScrollMax() {
  const se = document.scrollingElement || document.documentElement;
  const view = window.innerHeight || document.documentElement.clientHeight || 0;
  const height = Math.max(
    se.scrollHeight,
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
  );
  return Math.max(0, height - view);
}

function isScrollable(el: Element) {
  const style = window.getComputedStyle(el);
  const overflowY = style.overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function findScrollers() {
  const list: Array<Window | Element> = [window];
  const seen = new Set<EventTarget>([window, document.documentElement, document.body]);
  const add = (node: Element | null | undefined) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    list.push(node);
  };
  add(document.scrollingElement);
  add(document.querySelector("main"));
  add(document.getElementById("root"));
  for (const el of document.querySelectorAll("body *")) {
    if (isScrollable(el)) add(el);
  }
  return list;
}

function readScroll(scrollers: Array<Window | Element>) {
  let best = { node: window as Window | Element, y: rootScrollY(), max: rootScrollMax() };
  for (const node of scrollers) {
    if (isRootScroller(node)) continue;
    const el = node as Element;
    const y = el.scrollTop || 0;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max > best.max || (max === best.max && y > best.y)) {
      best = { node, y, max };
    }
  }
  if (best.node === window) {
    best.y = rootScrollY();
    best.max = Math.max(best.max, rootScrollMax());
  }
  return best;
}

function metrics() {
  const narrow = window.matchMedia("(max-width: 599px)").matches;
  const count = items.length;
  if (narrow) {
    return {
      pad: 4,
      itemW: 52,
      itemH: 52,
      icon: 18,
      font: 9,
      labelGap: 1,
      itemPadX: 2,
      itemPadY: 4,
      border: 2,
      shadow: 3,
      gap: 0,
      compactPad: 3,
      compactItemW: 42,
      compactItemH: 36,
      compactIcon: 16,
      compactFont: 8,
      compactLabelGap: 0,
      compactItemPadX: 2,
      compactItemPadY: 3,
      compactBorder: 1,
      compactShadow: 2,
      compactGap: 0,
      fullW: 4 * 2 + 52 * count + 2 * 2,
      fullH: 4 * 2 + 52 + 2 * 2,
      compactW: 3 * 2 + 42 * count + 1 * 2,
      compactH: 3 * 2 + 36 + 1 * 2,
    };
  }
  return {
    pad: 6,
    itemW: 64,
    itemH: 58,
    icon: 18,
    font: 10,
    labelGap: 2,
    itemPadX: 4,
    itemPadY: 6,
    border: 2,
    shadow: 3,
    gap: 0,
    compactPad: 3,
    compactItemW: 52,
    compactItemH: 40,
    compactIcon: 16,
    compactFont: 9,
    compactLabelGap: 1,
    compactItemPadX: 3,
    compactItemPadY: 3,
    compactBorder: 1,
    compactShadow: 2,
    compactGap: 0,
    fullW: 6 * 2 + 64 * count + 2 * 2,
    fullH: 6 * 2 + 58 + 2 * 2,
    compactW: 3 * 2 + 52 * count + 1 * 2,
    compactH: 3 * 2 + 40 + 1 * 2,
  };
}

function pillSpot(active: HTMLElement, compact: boolean) {
  const inset = compact ? 6 : 8;
  const size = Math.max(2, Math.round(Math.min(active.offsetWidth, active.offsetHeight) - inset));
  return {
    left: Math.round(active.offsetLeft + (active.offsetWidth - size) / 2),
    top: Math.round(active.offsetTop + (active.offsetHeight - size) / 2),
    width: size,
    height: size,
    x: 0,
    y: 0,
  };
}

const tweenBase = { force3D: false as const, overwrite: "auto" as const };

function snapNumber(value: unknown) {
  return typeof value === "number" ? Math.round(value) : value;
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
  const lastRealY = useRef(0);
  const accum = useRef(0);

  const placePill = (animate: boolean) => {
    const pill = pillRef.current;
    const dock = dockRef.current;
    const active = dock?.querySelector<HTMLElement>("[aria-current='true']");
    if (!pill || !active) return;
    const spot = pillSpot(active, foldedRef.current);
    if (!placed.current || reducedMotion() || !animate) {
      gsap.set(pill, { ...spot, ...tweenBase });
      placed.current = true;
      return;
    }
    gsap.to(pill, { ...spot, duration: 0.32, ease: "power2.out", ...tweenBase });
  };

  const snapLayout = () => {
    const dock = dockRef.current;
    if (!dock) return;
    const sizeKeys = [
      "width",
      "height",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderWidth",
      "gap",
      "fontSize",
    ] as const;
    const nodes = [dock, ...dock.querySelectorAll<HTMLElement>(":scope > a, :scope > a span, :scope > a svg")];
    for (const node of nodes) {
      const next: gsap.TweenVars = { force3D: false };
      for (const key of sizeKeys) {
        const value = snapNumber(gsap.getProperty(node, key));
        if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
      }
      gsap.set(node, next);
      gsap.set(node, { clearProps: "transform,x,y,z,top,scale,rotation" });
    }
    const pill = pillRef.current;
    if (pill) {
      const left = snapNumber(gsap.getProperty(pill, "left"));
      const top = snapNumber(gsap.getProperty(pill, "top"));
      const width = snapNumber(gsap.getProperty(pill, "width"));
      const height = snapNumber(gsap.getProperty(pill, "height"));
      gsap.set(pill, {
        force3D: false,
        left: typeof left === "number" ? left : 0,
        top: typeof top === "number" ? top : 0,
        width: typeof width === "number" ? width : 0,
        height: typeof height === "number" ? height : 0,
        clearProps: "transform,x,y,z,scale,rotation",
      });
    }
    placePill(false);
  };

  const applyLayout = (nextFolded: boolean, animate: boolean) => {
    const dock = dockRef.current;
    if (!dock) return;
    const links = Array.from(dock.querySelectorAll<HTMLElement>(":scope > a"));
    const m = metrics();
    const duration = animate && !reducedMotion() ? MORPH : 0;
    const pad = nextFolded ? m.compactPad : m.pad;
    const itemW = nextFolded ? m.compactItemW : m.itemW;
    const itemH = nextFolded ? m.compactItemH : m.itemH;
    const icon = nextFolded ? m.compactIcon : m.icon;
    const font = nextFolded ? m.compactFont : m.font;
    const labelGap = nextFolded ? m.compactLabelGap : m.labelGap;
    const padX = nextFolded ? m.compactItemPadX : m.itemPadX;
    const padY = nextFolded ? m.compactItemPadY : m.itemPadY;
    const border = nextFolded ? m.compactBorder : m.border;
    const shadow = nextFolded ? m.compactShadow : m.shadow;
    const gap = nextFolded ? m.compactGap : m.gap;
    const width = nextFolded ? m.compactW : m.fullW;
    const height = nextFolded ? m.compactH : m.fullH;
    morphing.current?.kill();
    const tl = gsap.timeline({
      defaults: { duration, ease: EASE, ...tweenBase },
      onUpdate: () => placePill(false),
      onComplete: () => snapLayout(),
    });
    morphing.current = tl;
    tl.to(
      dock,
      {
        width,
        height,
        paddingTop: pad,
        paddingRight: pad,
        paddingBottom: pad,
        paddingLeft: pad,
        borderRadius: 999,
        borderWidth: border,
        gap,
        boxShadow: `${shadow}px ${shadow}px 0 ${INK}`,
      },
      0,
    );
    for (const link of links) {
      const iconNode = link.querySelector<SVGElement>("svg");
      const label = link.querySelector<HTMLElement>("span");
      tl.to(
        link,
        {
          width: itemW,
          minWidth: itemW,
          maxWidth: itemW,
          height: itemH,
          minHeight: itemH,
          paddingTop: padY,
          paddingBottom: padY,
          paddingLeft: padX,
          paddingRight: padX,
          gap: labelGap,
          autoAlpha: 1,
        },
        0,
      );
      if (iconNode) {
        tl.to(iconNode, { width: icon, height: icon, attr: { width: icon, height: icon } }, 0);
      }
      if (label) {
        tl.to(label, { fontSize: font, autoAlpha: 1 }, 0);
      }
      link.setAttribute("aria-hidden", "false");
      link.tabIndex = 0;
    }
    if (duration === 0) {
      snapLayout();
    }
  };

  const setFoldedState = (next: boolean, animate = true) => {
    if (foldedRef.current === next) return;
    foldedRef.current = next;
    setFolded(next);
    applyLayout(next, animate);
  };

  useLayoutEffect(() => {
    if (morphing.current?.isActive()) {
      placePill(false);
      return;
    }
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
    let scrollers = findScrollers();
    const primary = () => readScroll(scrollers);
    lastY.current = primary().y;
    lastRealY.current = lastY.current;

    const applyDelta = (dy: number, y: number, max: number, fromInput = false) => {
      if (!fromInput && (y <= TOP_EDGE || (max > 0 && y >= max - BOTTOM_EDGE))) {
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

    const fromPosition = () => {
      const state = primary();
      const dy = state.y - lastRealY.current;
      lastRealY.current = state.y;
      lastY.current = state.y;
      applyDelta(dy, state.y, state.max);
    };

    type Bound = { node: EventTarget; ev: string };
    const bound: Bound[] = [];
    const bind = () => {
      for (const item of bound) {
        item.node.removeEventListener(item.ev, fromPosition as EventListener);
      }
      bound.length = 0;
      scrollers = findScrollers();
      const add = (node: EventTarget | null | undefined, ev = "scroll") => {
        if (!node) return;
        node.addEventListener(ev, fromPosition as EventListener, { passive: true, capture: true });
        bound.push({ node, ev });
      };
      add(window);
      add(document);
      add(document.documentElement);
      add(document.body);
      for (const node of scrollers) add(node);
      add(window.visualViewport ?? undefined, "scroll");
      add(window.visualViewport ?? undefined, "resize");
      lastY.current = primary().y;
      lastRealY.current = lastY.current;
    };
    bind();
    window.addEventListener("resize", bind);

    const observer = Observer.create({
      type: "wheel,touch,scroll",
      tolerance: 2,
      preventDefault: false,
      onChangeY(self) {
        const state = primary();
        if (state.y !== lastRealY.current) {
          fromPosition();
          return;
        }
        const ev = self.event as Event | undefined;
        const kind = ev?.type || "";
        if (kind === "wheel") {
          applyDelta(self.deltaY, state.y, state.max);
          return;
        }
        if (kind.includes("touch") || kind.includes("pointer")) {
          applyDelta(-self.deltaY, state.y, state.max, true);
        }
      },
    });

    return () => {
      observer.kill();
      window.removeEventListener("resize", bind);
      for (const item of bound) {
        item.node.removeEventListener(item.ev, fromPosition as EventListener);
      }
    };
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
    const evs: Array<[EventTarget, string]> = [
      [window, "scroll"],
      [document, "scroll"],
      [document.documentElement, "scroll"],
      [document.body, "scroll"],
    ];
    if (window.visualViewport) evs.push([window.visualViewport, "scroll"], [window.visualViewport, "resize"]);
    for (const [node, ev] of evs) node.addEventListener(ev, syncCurrent, { passive: true, capture: true });
    window.addEventListener("resize", syncCurrent);
    return () => {
      for (const [node, ev] of evs) node.removeEventListener(ev, syncCurrent);
      window.removeEventListener("resize", syncCurrent);
    };
  }, []);

  return createPortal(
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
          onClick={() => {
            if (foldedRef.current) setFoldedState(false);
            setCurrent(item.id);
          }}
        >
          <Icon name={item.id} />
          <span>{item.label}</span>
        </a>
      ))}
    </nav>,
    document.body,
  );
}

function Icon({ name }: { name: string }) {
  const common = {
    className: "dock-icon",
    width: 18,
    height: 18,
    viewBox: "0 0 18 18",
    fill: "none",
    "aria-hidden": true as const,
  };
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
