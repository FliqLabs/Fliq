import Image from "next/image";
import Link from "next/link";
import { CORRIDORS } from "../lib/corridors";
import { siteContainer } from "../components/site-container";

const payoutDetail: Record<string, { flag: string; methods: string }> = {
  ngn: { flag: "ng", methods: "Bank transfer, OPay" },
  kes: { flag: "ke", methods: "M-Pesa" },
  ghs: { flag: "gh", methods: "Mobile money" },
  ugx: { flag: "ug", methods: "Mobile money" },
  tzs: { flag: "tz", methods: "Mobile money" },
  zar: { flag: "za", methods: "Bank transfer" },
};

export function Countries() {
  return (
    <section id="countries" className={`${siteContainer} pt-10 pb-16 lg:pt-16 lg:pb-24`}>
      <p className="text-[15px] text-zinc-500">Cash out</p>
      <h2 className="mt-3 max-w-[760px] text-[34px] leading-[1.05] font-medium tracking-[-0.04em] text-white sm:text-[48px]">
        Pay a bank or mobile wallet in their own currency.
      </h2>
      <p className="mt-5 max-w-[520px] text-[17px] leading-7 text-zinc-400 sm:text-[19px] sm:leading-[30px]">
        Pick who you&rsquo;re paying and send from your dollar balance. Compare available corridors below, with
        more on the way.
      </p>
      <ul className="mt-10 grid gap-3.5 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3">
        {CORRIDORS.map((corridor) => {
          const detail = payoutDetail[corridor.code];
          return (
            <li
              key={corridor.code}
              className={`flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#151515] px-4 py-4 ${corridor.live ? "" : "opacity-60"}`}
            >
              <Image
                src={`/landing/icons/flags/${detail?.flag ?? corridor.code.slice(0, 2)}.svg`}
                alt=""
                width={36}
                height={36}
                className="size-9 rounded-full object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] text-white">{corridor.country}</span>
                <span className="block text-[13px] text-zinc-500">{detail?.methods ?? corridor.method}</span>
              </span>
              {corridor.live ? (
                <Link
                  href={`/rates/${corridor.code}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#a594ff]/15 px-2.5 py-1 text-[12px] font-medium text-[#c4b8ff] hover:bg-[#a594ff]/25"
                >
                  Explore rates
                </Link>
              ) : (
                <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] text-zinc-400">
                  Soon
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
