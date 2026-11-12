"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AuthShell } from "../auth/auth-shell";
import { EmailLinkSent } from "./email-link-sent";
import { labelPasskey, signInWithPasskey } from "../auth/passkey";
import { fliqApi, type User } from "../lib/fliq-api";

const copy = {
  "sign-in": { title: "Sign in", subtitle: "To your fliq wallet." },
  "get-started": {
    title: "Get started",
    subtitle:
      "Already on the fliq app? Continue with the passkey you saved there. New here? Create an account.",
  },
};

export function SignInForm({
  intent = "sign-in",
  onSignedIn,
  standalone = false,
}: {
  intent?: keyof typeof copy;
  onSignedIn?: (user: User) => void;
  standalone?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [resendAt, setResendAt] = useState(0);

  function afterSignIn(user: User) {
    queryClient.clear();
    queryClient.setQueryData(["me"], user);
    labelPasskey(user);
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
    onSuccess: (_, address) => {
      setSentEmail(address);
      setResendAt(Date.now() + 60_000);
    },
  });

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    emailLink.mutate(email.trim());
  }

  if (sentEmail) {
    const confirmation = (
      <EmailLinkSent
        email={sentEmail}
        resendAt={resendAt}
        pending={emailLink.isPending}
        error={emailLink.error?.message}
        onResend={() => emailLink.mutate(sentEmail)}
        onChangeEmail={() => {
          setSentEmail("");
          emailLink.reset();
        }}
      />
    );
    return standalone
      ? confirmation
      : createPortal(
          <div className="fixed inset-0 z-[100] overflow-y-auto">{confirmation}</div>,
          document.body,
        );
  }

  const form = (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{copy[intent].title}</h1>
      <p className="mt-1 text-sm text-zinc-500">{copy[intent].subtitle}</p>
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
      <button
        type="button"
        disabled={passkey.isPending}
        onClick={() => passkey.mutate("register")}
        className="mt-3 min-h-12 rounded-lg border border-zinc-200 px-5 text-sm font-semibold disabled:opacity-60"
      >
        {passkey.isPending && passkey.variables === "register"
          ? "Waiting for passkey…"
          : "Create a new account"}
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
      {emailLink.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {emailLink.error.message}
        </p>
      )}
    </>
  );
  return standalone ? <AuthShell>{form}</AuthShell> : form;
}
