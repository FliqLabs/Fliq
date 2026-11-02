import Link from "next/link";

export function JoinWaitlistLink() {
  return (
    <Link
      href="/join-waitlist"
      className="inline-flex min-h-12 items-center justify-center rounded-xl border border-zinc-100 bg-zinc-100 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:border-brand hover:bg-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
    >
      Join waitlist
    </Link>
  );
}
