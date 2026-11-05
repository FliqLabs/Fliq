"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signInWithPasskey } from "../auth/passkey";
import { fliqApi, type User } from "../lib/fliq-api";

export function SignInForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  function afterSignIn(user: User) {
    queryClient.clear();
    queryClient.setQueryData(["me"], user);
    router.replace(user.near_account ? "/dashboard" : "/claim-name");
  }

  const passkey = useMutation({ mutationFn: signInWithPasskey, onSuccess: afterSignIn });
  const emailLink = useMutation({
    mutationFn: (address: string) =>
      fliqApi<{ status: "sent" }>("auth/email-links", {
        method: "POST",
        body: JSON.stringify({ email: address }),
      }),
  });

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    emailLink.mutate(email.trim());
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500">To the fliq dashboard.</p>
      <button
        type="button"
        disabled={passkey.isPending}
        onClick={() => passkey.mutate("login")}
        className="mt-7 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {passkey.isPending && passkey.variables === "login"
          ? "Waiting for passkey…"
          : "Continue with passkey"}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        Already have a passkey for this site? Sign in above. New here? Create an account below.
      </p>
      <button
        type="button"
        disabled={passkey.isPending}
        onClick={() => passkey.mutate("register")}
        className="mt-3 min-h-12 rounded-lg border border-zinc-200 px-5 text-sm font-semibold disabled:opacity-60"
      >
        Create an account with passkey
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
