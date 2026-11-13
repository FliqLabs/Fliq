import { Suspense } from "react";
import { PageState } from "../../components/app/ui";
import { SendFlow } from "./send-flow";

export default function SendPage() {
  return (
    <Suspense fallback={<PageState message="Opening send" />}>
      <SendFlow />
    </Suspense>
  );
}
