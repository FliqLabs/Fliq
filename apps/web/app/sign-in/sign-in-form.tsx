"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signInWithPasskey } from "../auth/passkey";
import { fliqApi, type User } from "../lib/fliq-api";

const copy = {
  "sign-in": { title: "Sign in", subtitle: "To your fliq wallet." },
  "get-started": {
    title: "Get started",
    subtitle: "Create your fliq account with a passkey. No password, no seed phrase.",
  },
};

export function SignInForm({
  intent = "sign-in",
  onSignedIn,
}: {
  intent?: keyof typeof copy;
  onSignedIn?: (user: User) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  function afterSignIn(user: User) {
    queryClient.clear();
    queryClient.setQueryData(["me"], user);
    if (onSignedIn) onSignedIn(user);
    else router.replace(user.near_account ? "/wallet" : "/claim-name");
  }

  const passkey = useMutation({ mutationFn: signInWithPasskey, onSuccess: afterSignIn });
  const emailLink = useMutation({
    mutationFn: (address: string) =>
      fliqApi<{ status: "sent" }>("auth/email-links", {
        method: "POST",
        body: JSON.stringify({ email: address }),
      }),
  });

  const newcomer = intent === "get-started";
  const primary = newcomer ? "register" : "login";
  const secondary = newcomer ? "login" : "register";
  const primaryLabel = newcomer ? "Create an account with passkey" : "Continue with passkey";
  const secondaryLabel = newcomer ? "I already have a passkey" : "Create an account with passkey";
  const hint = newcomer
    ? "Your phone or laptop saves the passkey. Signing in later is one tap."
    : "Already have a passkey for this site? Sign in above. New here? Create an account below.";

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    emailLink.mutate(email.trim());
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{copy[intent].title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{copy[intent].subtitle}</p>
      <button
        type="button"
        disabled={passkey.isPending}
        onClick={() => passkey.mutate(primary)}
        className="mt-7 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {passkey.isPending && passkey.variables === primary ? "Waiting for passkey…" : primaryLabel}
      </button>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
      <button
        type="button"
        disabled={passkey.isPending}
        onClick={() => passkey.mutate(secondary)}
        className="mt-3 min-h-12 rounded-lg border border-zinc-200 px-5 text-sm font-semibold disabled:opacity-60"
      >
        {passkey.isPending && passkey.variables === secondary ? "Waiting for passkey…" : secondaryLabel}
      </button>
      {passkey.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {passkey.error.message}
        </p>
      )}

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
      <form onSubmit={submitEmail} className="flex flex-col">
        <label htmlFor="work-email" className="text-xs font-medium">
          Work email
        </label>
        <input
          id="work-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          className="mt-1.5 min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
        />
        <button
          type="submit"
          disabled={emailLink.isPending}
          className="mt-4 min-h-12 rounded-lg border border-zinc-200 text-sm font-semibold disabled:opacity-60"
        >
          {emailLink.isPending ? "Sending link…" : "Email me a sign-in link"}
        </button>
      </form>
      {emailLink.isSuccess && (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          If the address can receive mail, a sign-in link is on its way.
        </p>
      )}
      {emailLink.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {emailLink.error.message}
        </p>
      )}
    </>
  );
}
