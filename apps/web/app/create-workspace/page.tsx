import type { Metadata } from "next";
import { AuthShell } from "../auth/auth-shell";
import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata: Metadata = {
  title: "Create a workspace | Fliq",
  description: "Set up a Fliq workspace and sandbox key.",
};

export default function CreateWorkspacePage() {
  return (
    <AuthShell>
      <CreateWorkspaceForm />
    </AuthShell>
  );
}
