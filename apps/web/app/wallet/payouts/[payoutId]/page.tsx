import { Suspense } from "react";
import { PageState } from "../../../components/app/ui";
import { PayoutTracker } from "./payout-tracker";

async function Tracker({ params }: { params: Promise<{ payoutId: string }> }) {
  const { payoutId } = await params;
  return <PayoutTracker payoutId={payoutId} />;
}

export default function PayoutPage({ params }: PageProps<"/wallet/payouts/[payoutId]">) {
  return (
    <Suspense fallback={<PageState message="Finding this payout" />}>
      <Tracker params={params} />
    </Suspense>
  );
}
