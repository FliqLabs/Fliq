import type { Metadata } from "next";
import { WebhooksData } from "./webhooks-data";

export const metadata: Metadata = {
  title: "Webhooks | Fliq",
  description: "Review webhook deliveries in your Fliq workspace.",
};

export default function WebhooksPage() {
  return <WebhooksData />;
}
