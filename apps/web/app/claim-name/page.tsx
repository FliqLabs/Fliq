import type { Metadata } from "next";
import { AuthShell } from "../auth/auth-shell";
import { ClaimNameForm } from "./claim-name-form";

export const metadata: Metadata = { title: "Claim your name | Fliq" };

export default function ClaimNamePage() {
  return (
    <AuthShell>
      <ClaimNameForm />
    </AuthShell>
  );
}
