"use client";

import React, { useMemo } from "react";
import QRCode from "qrcode";

interface QrMatrixProps {
  value: string;
  size?: number;
  label: string;
}

export function QrMatrix({ value, size = 112, label }: QrMatrixProps) {
  const { modules, count } = useMemo(() => {
    try {
      const qr = QRCode.create(value || "https://dockpilot.adelev8.com", {
        errorCorrectionLevel: "M",
      });
      const n = qr.modules.size;
      const list: Array<{ x: number; y: number }> = [];
      for (let r = 0; r < n; r += 1) {
        for (let c = 0; c < n; c += 1) {
          if (qr.modules.get(r, c)) {
            list.push({ x: c, y: r });
          }
        }
      }
      return { modules: list, count: n };
    } catch {
      return { modules: [], count: 21 };
    }
  }, [value]);

  const pad = 2;
  const view = count + pad * 2;

  return (
    <div
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-line bg-white p-1.5"
      style={{ width: size, height: size }}
    >
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${view} ${view}`}
        width={size - 14}
        height={size - 14}
        shapeRendering="crispEdges"
      >
        <rect width={view} height={view} fill="#FFFFFF" />
        {modules.map((m) => (
          <rect
            key={`${m.x}-${m.y}`}
            x={m.x + pad}
            y={m.y + pad}
            width={1}
            height={1}
            fill="#19191B"
          />
        ))}
      </svg>
    </div>
  );
}
