import { useMemo, useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { Vector3 } from "three";
import type { Part } from "../domain/model";
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", f);
    const prev = document.activeElement as HTMLElement;
    const focus = setTimeout(
      () => document.querySelector<HTMLElement>(".modal button")?.focus(),
      20,
    );
    return () => {
      clearTimeout(focus);
      document.removeEventListener("keydown", f);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const a = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select,textarea,a[href]",
              ),
            );
            const first = a[0],
              last = a.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">CATALYST FOUNDRY</div>
            <h2>{title}</h2>
            {subtitle && <p className="subtitle">{subtitle}</p>}
          </div>
          <button
            className="iconbtn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </section>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  override,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  override?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {override && <span className="override">modified</span>}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
export function PartThumbnail({ part }: { part: Part }) {
  const triangles = useMemo(() => {
    try {
      const g = new STLLoader().parse(part.geometry.stl),
        p = g.getAttribute("position");
      const projected: { points: number[][]; depth: number; shade: number }[] =
        [];
      const xaxis = new Vector3(0.82, -0.57, 0),
        yaxis = new Vector3(0.32, 0.46, 0.83),
        zaxis = new Vector3(-0.47, -0.68, 0.56);
      let minx = Infinity,
        miny = Infinity,
        maxx = -Infinity,
        maxy = -Infinity;
      const stride = Math.max(1, Math.ceil(p.count / 3 / 1400));
      for (let i = 0; i < p.count; i += 3 * stride) {
        const points = [];
        let depth = 0;
        for (let j = 0; j < 3; j++) {
          const v = new Vector3().fromBufferAttribute(p, i + j),
            x = v.dot(xaxis),
            y = -v.dot(yaxis);
          points.push([x, y]);
          depth += v.dot(zaxis);
          minx = Math.min(minx, x);
          maxx = Math.max(maxx, x);
          miny = Math.min(miny, y);
          maxy = Math.max(maxy, y);
        }
        const a = new Vector3().fromBufferAttribute(p, i),
          b = new Vector3().fromBufferAttribute(p, i + 1),
          c = new Vector3().fromBufferAttribute(p, i + 2);
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        projected.push({
          points,
          depth,
          shade: Math.abs(normal.dot(new Vector3(-0.5, -0.6, 1).normalize())),
        });
      }
      const scale = 36 / Math.max(maxx - minx, maxy - miny, 1);
      g.dispose();
      return projected
        .sort((a, b) => a.depth - b.depth)
        .map((t) => ({
          points: t.points
            .map(
              ([x, y]) =>
                `${(x - (minx + maxx) / 2) * scale + 23},${(y - (miny + maxy) / 2) * scale + 23}`,
            )
            .join(" "),
          color: `hsl(13 63% ${43 + t.shade * 27}%)`,
        }));
    } catch {
      return [];
    }
  }, [part.geometry.hash]);
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 46 46"
      aria-label={`${part.name} thumbnail`}
    >
      {triangles.map((t, i) => (
        <polygon
          key={i}
          points={t.points}
          fill={t.color}
          stroke={t.color}
          strokeWidth=".15"
        />
      ))}
    </svg>
  );
}
export function download(
  data: BlobPart,
  name: string,
  type = "application/octet-stream",
) {
  const b = new Blob([data], { type });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}
export function shortHash(value?: string) {
  return value ? `${value.slice(0, 12)}…${value.slice(-6)}` : "—";
}
export function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
