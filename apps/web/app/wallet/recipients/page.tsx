import { Suspense } from "react";
import { PageState } from "../../components/app/ui";
import { RecipientsPage } from "./recipients-page";

export default function WalletRecipientsPage() {
  return (
    <Suspense fallback={<PageState message="Loading recipients" />}>
      <RecipientsPage />
    </Suspense>
  );
}
