"use client";

/* eslint-disable @next/next/no-img-element -- small fixed-size logos; next/image adds nothing here */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { avatarHue } from "../../lib/assets";
import { decimalsOf, symbolOf, type CurrencyCode } from "../../lib/money";
import { Icon, type IconName } from "./icons";

export function Avatar({
  name,
  photo,
  badge,
  size,
}: {
  name: string;
  photo?: string | null;
  badge?: string | null;
  size?: "sm" | "xs";
}) {
  return (
    <span className={`av ${size ?? ""}`}>
      {photo ? (
        <img src={photo} alt="" />
      ) : (
        <img src="/app/avatar.webp" alt="" style={{ filter: `hue-rotate(${avatarHue(name)}deg) saturate(1.3)` }} />
      )}
      {badge && <img className="bd" src={badge} alt="" />}
    </span>
  );
}

export function Logo({ src, badge, size }: { src: string; badge?: string | null; size?: "sm" | "xs" }) {
  return (
    <span className={`av ${size ?? ""}`}>
      <img src={src} alt="" />
      {badge && <img className="bd" src={badge} alt="" />}
    </span>
  );
}

export function IconBubble({ name, size }: { name: IconName; size?: "sm" | "xs" }) {
  return (
    <span className={`av ${size ?? ""}`}>
      <span className="ph">
        <Icon name={name} size={size === "xs" ? 14 : 18} />
      </span>
    </span>
  );
}

export function BigMoney({ value, currency }: { value: number | string; currency: CurrencyCode }) {
  const decimals = decimalsOf(currency);
  return (
    <>
      <span className="cs">{symbolOf(currency).trim()}</span>
      {Number(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </>
  );
}

export function Chip({
  tone,
  dot,
  children,
}: {
  tone?: "good" | "bad" | "sand" | "acc";
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`chip ${tone ?? ""}`}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}

export function Spinner() {
  return <span className="spin" role="status" aria-label="Loading" />;
}

export function Notice({
  tone,
  icon = "info",
  children,
}: {
  tone?: "warn" | "bad" | "good";
  icon?: IconName | "spin";
  children: ReactNode;
}) {
  return (
    <div className={`notice ${tone ?? ""}`}>
      {icon === "spin" ? <Spinner /> : <Icon name={icon} size={18} />}
      <span>{children}</span>
    </div>
  );
}

function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, enabled]);
}

export function Drawer({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-h">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </aside>
    </>
  );
}

export function Modal({
  onClose,
  locked,
  label,
  children,
}: {
  onClose: () => void;
  locked?: boolean;
  label: string;
  children: ReactNode;
}) {
  useEscape(onClose, !locked);
  return (
    <>
      <div className="scrim" onClick={locked ? undefined : onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

export function ConfirmModal({
  title,
  text,
  cta,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  cta: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} locked={busy} label={title}>
      <div className="modal-b">
        <h2>{title}</h2>
        <p>{text}</p>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="row2">
          <button type="button" className="btn line lg" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? "danger" : "ink"} lg`} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : cta}
          </button>
        </div>
      </div>
    </Modal>
  );
}

type Toast = { id: number; message: string; icon: IconName };
const ToastContext = createContext<(message: string, icon?: IconName) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, icon: IconName = "check") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, icon }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <Icon name={toast.icon} size={18} />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string, done = "Copied") => {
      try {
        await navigator.clipboard.writeText(text);
        toast(done);
      } catch {
        toast("Select the text and copy it", "info");
      }
    },
    [toast],
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function PageState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="page">
      <section className="card pad" style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <p className="muted" style={{ margin: 0 }}>
          {message}
        </p>
        {action}
      </section>
    </div>
  );
}
