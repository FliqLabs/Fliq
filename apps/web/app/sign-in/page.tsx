import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in | Fliq",
  description: "Sign in to your Fliq workspace.",
};

export default function SignInPage() {
  return <SignInForm standalone />;
}
