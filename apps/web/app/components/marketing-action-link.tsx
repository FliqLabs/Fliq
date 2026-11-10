import Link from "next/link";
import type { ReactNode } from "react";

const baseClassName =
  "inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand";

const variantClassName = {
  primary: "bg-zinc-100 text-zinc-950 hover:bg-brand",
  secondary: "border border-zinc-600 text-white hover:border-white",
};

export function MarketingActionLink({
  children,
  href,
  variant = "primary",
}: {
  children: ReactNode;
  href: string;
  variant?: keyof typeof variantClassName;
}) {
  return (
    <Link href={href} className={`${baseClassName} ${variantClassName[variant]}`}>
      {children}
    </Link>
  );
}
