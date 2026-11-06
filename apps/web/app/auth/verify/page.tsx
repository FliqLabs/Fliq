import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";
import { VerifyEmailLink } from "./verify-email-link";

export const metadata: Metadata = { title: "Verify sign-in | Fliq" };

export default function VerifyPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="text-sm text-zinc-500">Checking your link…</p>}>
        <VerifyEmailLink />
      </Suspense>
    </AuthShell>
  );
}
