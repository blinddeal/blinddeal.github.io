import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

const items = [
  { id: "hero", label: "Home" },
  { id: "demo", label: "Demo" },
  { id: "desk", label: "Desk" },
  { id: "how", label: "How" },
  { id: "why", label: "Uses" },
  { id: "tech", label: "Tech" },
];

export function Dock() {
  const [current, setCurrent] = useState("hero");
  const dockRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    const pill = pillRef.current;
    if (!dock || !pill) return;
    const active = dock.querySelector<HTMLElement>("[aria-current='true']");
    if (!active) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spot = {
      x: active.offsetLeft,
      y: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    };
    if (!placed.current || reduce) {
      gsap.set(pill, spot);
      placed.current = true;
      return;
    }
    gsap.to(pill, { ...spot, duration: 0.38, ease: "power2.out", overwrite: "auto" });
  }, [current]);

  useEffect(() => {
    const nodes = items
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => Boolean(node));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setCurrent(visible.target.id);
      },
      { rootMargin: "-40% 0px -45% 0px", threshold: [0.15, 0.4, 0.7] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="dock" aria-label="Sections" ref={dockRef}>
      <span className="dock-pill" ref={pillRef} aria-hidden="true" />
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={current === item.id}
          className={item.id === "hero" ? "pressable" : undefined}
        >
          <Icon name={item.id} />
          <span>{item.label}</span>
        </a>
      ))}
      <a href="https://x.com/nirempathys" target="_blank" rel="noreferrer" aria-label="Follow @nirempathys on X">
        <Icon name="x" />
        <span>Follow</span>
      </a>
    </nav>
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
  if (name === "demo") {
    return (
      <svg {...common}>
        <rect x="2" y="6" width="6" height="8" rx="2" stroke="#1c1c1c" strokeWidth="1.7" />
        <rect x="10" y="4" width="6" height="10" rx="2" stroke="#1c1c1c" strokeWidth="1.7" />
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
  if (name === "tech") {
    return (
      <svg {...common}>
        <path d="M4 5h10v8H4z" stroke="#1c1c1c" strokeWidth="1.7" />
        <path d="M6 8h3M6 11h6" stroke="#1c1c1c" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 4h3.2l1.4 1.6L12.2 4H15l-4.3 5L15 14h-3.1l-1.8-2.1L8 14H5l4.1-5L4 4z" fill="#1c1c1c" />
    </svg>
  );
}
