import type { Metadata } from "next";
import { ApiKeysList } from "../api-keys-list";

export const metadata: Metadata = { title: "New API key | Fliq" };

export default function NewKeyPage() {
  return <ApiKeysList initialAction="new" initialEnvironment="test" />;
}
