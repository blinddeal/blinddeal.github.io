import { useMemo } from "react";
import { encode } from "uqr";

export function QrCode({ text, size = 196, title = "QR code" }: { text: string; size?: number; title?: string }) {
  const svg = useMemo(() => {
    const qr = encode(text, { border: 2 });
    const modules = qr.size;
    const cell = 1;
    const parts: string[] = [];
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if (qr.data[y][x]) parts.push(`M${x} ${y}h${cell}v${cell}h-${cell}z`);
      }
    }
    return { modules, d: parts.join("") };
  }, [text]);
  return (
    <svg
      className="qr-svg"
      width={size}
      height={size}
      viewBox={`0 0 ${svg.modules} ${svg.modules}`}
      role="img"
      aria-label={title}
    >
      <rect width={svg.modules} height={svg.modules} fill="#fffdf8" />
      <path d={svg.d} fill="#1c1c1c" />
    </svg>
  );
}
