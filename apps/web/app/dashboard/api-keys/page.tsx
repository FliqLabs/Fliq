import type { Metadata } from "next";
import { ApiKeysList } from "./api-keys-list";

export const metadata: Metadata = { title: "API keys | Fliq" };

export default function ApiKeysPage() {
  return <ApiKeysList />;
}
