import type { Metadata } from "next";
import { WebhooksDashboard, type WebhookDelivery } from "./webhooks-dashboard";

export const metadata: Metadata = {
  title: "Webhooks | Fliq",
  description: "Review webhook deliveries in your Fliq workspace.",
};

const deliveries: WebhookDelivery[] = [];

export default function WebhooksPage() {
  return <WebhooksDashboard deliveries={deliveries} endpoint={null} />;
}
