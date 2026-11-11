"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A scannable QR for a deposit address, drawn as one SVG path. Always dark on white, whatever the theme. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (code.isDark(row, column)) d += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: d };
  }, [value]);
  return (
    <svg className="qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
