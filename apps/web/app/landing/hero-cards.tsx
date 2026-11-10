import Image from "next/image";

const eyebrow = "mb-[15px] block text-[10px] font-medium tracking-[-0.02em] sm:mb-[26px] sm:text-sm";

function Arrow({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Check({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ChainCard() {
  return (
    <>
      <span className={eyebrow}>Send from any chain</span>
      <div className="my-[9px] flex items-center gap-2 sm:mt-5 sm:mb-[25px] sm:gap-[17px]">
        <span className="grid size-[34px] place-items-center rounded-[11px] bg-white/[0.07] text-[13px] font-bold sm:size-[58px] sm:rounded-[18px] sm:text-xl">
          $
        </span>
        <Arrow size={22} />
        <span className="grid size-[34px] place-items-center rounded-full bg-[#a594ff] text-[18px] font-semibold text-[#0d0d12] sm:size-[58px] sm:text-[28px]">
          ₦
        </span>
      </div>
      <p className="flex items-center gap-1 text-[8px] tracking-[-0.025em] text-zinc-400 sm:gap-2 sm:text-[11px]">
        USDC on Solana, Base, NEAR <Arrow size={12} /> naira
      </p>
    </>
  );
}

export function VaultCard() {
  return (
    <div className="grid grid-cols-2 items-center gap-x-[17px] sm:block">
      <span className={`${eyebrow} col-span-2 !mb-3 sm:!mb-[26px]`}>Your vault</span>
      <span className="col-start-1 block text-[9px] tracking-[-0.01em] text-zinc-500 sm:text-[11px]">
        USD balance
      </span>
      <strong className="col-start-1 block text-[35px] leading-[1.3] font-medium tracking-[-0.04em] sm:text-[clamp(32px,3.3vw,46px)]">
        $128<span className="text-[0.56em]">.18</span>
      </strong>
      <div className="col-start-2 row-span-2 row-start-2 border-l border-black/[0.06] pl-[11px] sm:mt-[21px] sm:border-t sm:border-l-0 sm:pl-0">
        <div className="flex items-center gap-1.5 py-2.5 text-[8px] tracking-[-0.025em] sm:gap-2.5 sm:py-[15px] sm:text-[10px]">
          <Image
            src="/app/gtbank.webp"
            alt=""
            width={38}
            height={38}
            className="hidden size-[38px] rounded-full sm:block"
          />
          <span className="flex-1">
            DARA OKONKWO
            <small className="mt-1 block text-[7px] text-zinc-500 sm:text-[9px]">Paid · 20s</small>
          </span>
          <b className="font-semibold">−₦30,000</b>
        </div>
        <div className="flex items-center gap-1.5 border-t border-black/[0.06] py-2.5 text-[8px] tracking-[-0.025em] sm:gap-2.5 sm:py-[15px] sm:text-[10px]">
          <span className="hidden size-[38px] place-items-center rounded-full bg-[#a594ff] text-sm font-bold text-[#0d0d12] sm:grid">
            $
          </span>
          <span className="flex-1">
            From Solana
            <small className="mt-1 block text-[7px] text-zinc-500 sm:text-[9px]">200 USDC · 34s</small>
          </span>
          <b className="font-semibold text-[#5b4be0]">+$199.98</b>
        </div>
      </div>
    </div>
  );
}

export function PaidCard() {
  return (
    <>
      <span className={eyebrow}>Paid in 21 seconds</span>
      <Image
        src="/app/gtbank.webp"
        alt=""
        width={65}
        height={65}
        className="mb-[5px] size-[37px] rounded-full sm:mb-2.5 sm:size-[65px]"
      />
      <strong className="text-[10px] font-semibold tracking-[-0.02em] sm:text-sm">DARA OKONKWO</strong>
      <div className="mt-2.5 flex w-full max-w-[175px] items-center justify-between gap-2.5 rounded-full bg-white/[0.07] py-1 pr-1 pl-[11px] text-xs tracking-[-0.045em] sm:mt-[18px] sm:gap-5 sm:py-1.5 sm:pr-[7px] sm:pl-4 sm:text-base">
        <span>₦68,816</span>
        <span className="grid size-[23px] place-items-center rounded-full bg-[#a594ff] text-[#0d0d12] sm:size-[35px]">
          <Check />
        </span>
      </div>
    </>
  );
}
