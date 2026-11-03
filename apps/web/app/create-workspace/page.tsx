import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../auth/auth-shell";

export const metadata: Metadata = {
  title: "Create a workspace | Fliq",
  description: "Set up a Fliq workspace and sandbox key.",
};

const productTypes = ["Wallet", "Payroll", "Marketplace", "Agent", "Other"];
const payoutCountries = ["Nigeria", "Kenya", "Ghana", "Indonesia", "Philippines"];

export default function CreateWorkspacePage() {
  return (
    <AuthShell>
      <p className="mb-5 text-xs font-semibold text-zinc-500">
        1 Workspace &nbsp; · &nbsp; 2 Sandbox key &nbsp; · &nbsp; 3 First payout
      </p>
      <h1 className="text-3xl font-bold tracking-tight">Name your workspace</h1>
      <p className="mt-1 text-sm text-zinc-500">You can rename it later. The key comes next.</p>

      <label htmlFor="workspace-name" className="mt-7 text-xs font-medium">
        Workspace
      </label>
      <input
        id="workspace-name"
        type="text"
        autoComplete="organization"
        placeholder="Your workspace name"
        className="mt-1.5 min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
      />

      <fieldset className="mt-6">
        <legend className="mb-2 text-xs font-medium">What are you building?</legend>
        <div className="flex flex-wrap gap-2">
          {productTypes.map((type) => (
            <label key={type} className="cursor-pointer">
              <input type="radio" name="product-type" value={type} className="peer sr-only" />
              <span className="inline-flex rounded-full border border-zinc-200 px-3 py-1.5 text-xs peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white">
                {type}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 text-xs font-medium">Where do you pay out?</legend>
        <div className="flex flex-wrap gap-2">
          {payoutCountries.map((country) => (
            <label key={country} className="cursor-pointer">
              <input type="checkbox" name="payout-country" value={country} className="peer sr-only" />
              <span className="inline-flex rounded-full border border-zinc-200 px-3 py-1.5 text-xs peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white">
                {country}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        disabled
        className="mt-8 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Create workspace and sandbox key
      </button>
      <p className="mt-3 text-xs text-zinc-500">
        Workspace creation opens after passkey registration and vault setup are connected.
      </p>
      <Link href="/sign-in" className="mt-5 text-sm font-semibold hover:underline">
        Already have a workspace? Sign in
      </Link>
    </AuthShell>
  );
}
