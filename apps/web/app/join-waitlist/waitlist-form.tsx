"use client";

import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { useWaitlistStore } from "./waitlist-store";

const waitlistEndpoint = "/join-waitlist/api";

async function joinWaitlist(email: string): Promise<void> {
  const response = await fetch(waitlistEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (response.status === 409) {
    throw new Error("This email may already be on the list.");
  }

  if (!response.ok) {
    throw new Error("We couldn’t add you right now. Please try again.");
  }
}

function WaitlistFormFields() {
  const email = useWaitlistStore((state) => state.email);
  const setEmail = useWaitlistStore((state) => state.setEmail);
  const clearEmail = useWaitlistStore((state) => state.clearEmail);

  const signup = useMutation({
    mutationFn: joinWaitlist,
    retry: false,
    onSuccess: clearEmail,
  });

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);

    if (signup.isError || signup.isSuccess) {
      signup.reset();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signup.isPending) return;

    signup.mutate(email.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col">
      <label htmlFor="waitlist-email" className="mb-2 text-[13px] font-medium text-zinc-100">
        Email address
      </label>
      <input
        id="waitlist-email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={handleEmailChange}
        disabled={signup.isPending}
        required
        className="min-h-14 w-full rounded-none border border-zinc-600 bg-[#0e0e0e] px-4 py-3.5 text-base text-white outline-none placeholder:text-zinc-500 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={signup.isPending}
        className="mt-4.5 flex min-h-14 cursor-pointer items-center justify-between border border-[#f3f3f1] bg-[#f3f3f1] px-4 font-mono text-[11px] font-medium tracking-[0.08em] text-zinc-950 transition-colors hover:border-brand hover:bg-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60"
      >
        <span>{signup.isPending ? "JOINING…" : "JOIN THE WAITLIST"}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <div aria-live="polite" aria-atomic="true" className="min-h-7 pt-2.5 text-[13px]">
        {signup.isSuccess && <p className="text-green-200">You’re on the list. We’ll be in touch.</p>}
        {signup.isError && (
          <p role="alert" className="text-red-300">
            {signup.error.message}
          </p>
        )}
      </div>
    </form>
  );
}

export default function WaitlistForm() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WaitlistFormFields />
    </QueryClientProvider>
  );
}
