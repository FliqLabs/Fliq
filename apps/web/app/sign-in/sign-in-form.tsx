"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AuthShell } from "../auth/auth-shell";
import { EmailLinkSent } from "./email-link-sent";
import { labelPasskey, PasskeyPromptError, signInWithPasskey } from "../auth/passkey";
import { ApiError, fliqApi, type User } from "../lib/fliq-api";

type PasskeyAction = "login" | "check-before-create" | "register";

const copy = {
  "sign-in": { title: "Sign in", subtitle: "To your fliq wallet." },
  "get-started": {
    title: "Get started",
    subtitle:
      "Already have a Fliq account? Continue with your passkey. New here? Create an account.",
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
  const [showCreateOption, setShowCreateOption] = useState(false);
  const account = useQuery({
    queryKey: ["me"],
    queryFn: () => fliqApi<User>("me"),
    enabled: standalone,
    retry: false,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (standalone && account.isSuccess && !account.isFetching) {
      router.replace(account.data.near_account ? "/wallet" : "/claim-name");
    }
  }, [account.data, account.isFetching, account.isSuccess, router, standalone]);

  function afterSignIn(user: User) {
    queryClient.clear();
    queryClient.setQueryData(["me"], user);
    labelPasskey(user);
    if (onSignedIn) onSignedIn(user);
    else router.replace(user.near_account ? "/wallet" : "/claim-name");
  }

  const passkey = useMutation({
    mutationFn: (action: PasskeyAction) => signInWithPasskey(action === "register" ? "register" : "login"),
    onSuccess: afterSignIn,
    onError: (error, action) => {
      if (action === "check-before-create" && error instanceof PasskeyPromptError) {
        setShowCreateOption(true);
      }
    },
  });
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

  if (standalone && (account.isPending || account.isFetching || account.isSuccess)) {
    return <AuthShell><p className="text-sm text-zinc-500">Checking your account…</p></AuthShell>;
  }

  if (standalone && account.isError && !(account.error instanceof ApiError && account.error.status === 401)) {
    return <AuthShell><p role="alert" className="text-sm text-red-600">{account.error.message}</p></AuthShell>;
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
        onClick={() => {
          setShowCreateOption(false);
          passkey.mutate("login");
        }}
        className="mt-7 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {passkey.isPending && passkey.variables === "login"
          ? "Waiting for passkey…"
          : "Continue with passkey"}
      </button>
      <button
        type="button"
        disabled={passkey.isPending}
        onClick={() => {
          setShowCreateOption(false);
          passkey.mutate("check-before-create");
        }}
        className="mt-3 min-h-12 rounded-lg border border-zinc-200 px-5 text-sm font-semibold disabled:opacity-60"
      >
        {passkey.isPending && passkey.variables === "check-before-create"
          ? "Waiting for passkey…"
          : "Create a new account"}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        We’ll check for your existing passkey first. If you have an account, you’ll be signed in.
      </p>
      {showCreateOption && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-semibold">No passkey selected?</p>
          <p className="mt-1 text-sm text-zinc-600">
            If you already have a Fliq account, try signing in with its passkey. Creating an account gives you a separate name and empty wallet.
          </p>
          <button
            type="button"
            disabled={passkey.isPending}
            onClick={() => passkey.mutate("register")}
            className="mt-3 min-h-11 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {passkey.isPending && passkey.variables === "register" ? "Creating account…" : "I’m new to Fliq — create account"}
          </button>
        </div>
      )}
      {passkey.isError && !(showCreateOption && passkey.error instanceof PasskeyPromptError) && (
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
