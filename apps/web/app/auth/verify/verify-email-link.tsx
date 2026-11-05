"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { fliqApi, type User } from "../../lib/fliq-api";

export function VerifyEmailLink() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useSearchParams().get("token");
  const started = useRef(false);
  const verify = useMutation({
    mutationFn: (value: string) =>
      fliqApi<{ user: User }>("auth/email-links/verify", {
        method: "POST",
        body: JSON.stringify({ token: value }),
      }),
    onSuccess: ({ user }) => {
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
      router.replace(user.near_account ? "/dashboard" : "/claim-name");
    },
  });

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  return (
    <>
      <h1 className="text-3xl font-bold">Signing you in</h1>
      {!token && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          This link is missing its sign-in token.
        </p>
      )}
      {token && !verify.isError && (
        <p role="status" className="mt-3 text-sm text-zinc-500">
          Verifying your one-time link…
        </p>
      )}
      {verify.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {verify.error.message}
        </p>
      )}
      {(verify.isError || !token) && (
        <Link href="/sign-in" className="mt-5 text-sm font-semibold underline">
          Back to sign in
        </Link>
      )}
    </>
  );
}
