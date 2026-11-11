import { stateLabel } from "../payout-model";

const statusClasses = {
<<<<<<< HEAD
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  progress: "bg-blue-50 text-blue-800 ring-blue-200",
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
=======
  success: "bg-app-good-soft text-app-good ring-app-good-soft",
  danger: "bg-app-bad-soft text-app-bad ring-app-bad-soft",
  warning: "bg-app-warn-soft text-app-warn ring-app-warn-soft",
  progress: "bg-app-accent-soft text-app-accent ring-app-accent-soft",
  neutral: "bg-app-panel2 text-app-fg2 ring-app-line",
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
} as const;

export function payoutStatusTone(state: string): keyof typeof statusClasses {
  const normalized = state.replaceAll(" ", "_");

  if (normalized === "settled") return "success";
  if (["failed", "refused", "expired", "not_received", "refunded"].includes(normalized)) {
    return "danger";
  }
  if (
    ["provider_timeout", "awaiting_recon", "awaiting_deposit", "created", "refunding"].includes(normalized)
  ) {
    return "warning";
  }
  if (["deposit_seen", "routing", "with_provider", "paying_out"].includes(normalized)) {
    return "progress";
  }
  return "neutral";
}

export function PayoutStatusBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${statusClasses[payoutStatusTone(state)]}`}
    >
      {stateLabel(state)}
    </span>
  );
}
