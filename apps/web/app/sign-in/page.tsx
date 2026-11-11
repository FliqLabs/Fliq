import type { Metadata } from "next";
import { AuthShell } from "../auth/auth-shell";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in | Fliq",
  description: "Sign in to your Fliq workspace.",
};

export default function SignInPage() {
  return (
    <AuthShell>
      <SignInForm />
    </AuthShell>
  );
}
