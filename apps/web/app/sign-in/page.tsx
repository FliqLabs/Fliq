import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../auth/auth-shell";

export const metadata: Metadata = {
  title: "Sign in | Fliq",
  description: "Sign in to your Fliq workspace.",
};

export default function SignInPage() {
  return (
    <AuthShell>
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500">To the fliq dashboard.</p>

      <button
        type="button"
        disabled
        className="mt-7 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Continue with passkey
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>

      <label htmlFor="work-email" className="text-xs font-medium">
        Work email
      </label>
      <input
        id="work-email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        className="mt-1.5 min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
      />
      <button
        type="button"
        disabled
        className="mt-4 min-h-12 rounded-lg border border-zinc-200 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
      >
        Email me a sign-in link
      </button>
      <p className="mt-3 text-xs text-zinc-500">
        Sign-in opens when the backend passkey and email-link flows are ready.
      </p>
      <p className="mt-5 text-sm text-zinc-500">
        New here?{" "}
        <Link href="/create-workspace" className="font-semibold text-zinc-950 hover:underline">
          Create a workspace
        </Link>
      </p>
    </AuthShell>
  );
}
