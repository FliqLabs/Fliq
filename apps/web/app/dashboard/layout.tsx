import { Suspense, type ReactNode } from "react";
import { DashboardNavigation } from "./dashboard-navigation";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-950">
      <Suspense
        fallback={
          <div className="h-16 border-b border-zinc-200 lg:fixed lg:inset-y-0 lg:left-0 lg:w-[232px] lg:border-r" />
        }
      >
        <DashboardNavigation />
      </Suspense>
      <div className="min-w-0 lg:pl-[232px]">
        <div className="mx-auto max-w-[1440px] px-5 pt-7 pb-12 lg:px-8 lg:pt-[92px]">{children}</div>
      </div>
    </div>
  );
}
