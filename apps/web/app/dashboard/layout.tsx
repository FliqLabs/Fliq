import type { ReactNode } from "react";
import { AppFrame } from "../components/app/app-frame";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AppFrame mode="developer">
      <div className="page dev-page">{children}</div>
    </AppFrame>
  );
}
