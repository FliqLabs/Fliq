import Image from "next/image";
import type { Icon } from "./data";

export const eyebrow = "font-mono text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500";

export function IconRow({ icons, label }: { icons: Icon[]; label: string }) {
  return (
    <div aria-label={label} className="flex pl-2">
      {icons.map((icon) => (
        <Image
          key={icon.alt}
          src={icon.src}
          alt={icon.alt}
          width={36}
          height={36}
          className="-ml-2 size-9 rounded-full border-2 border-[#1a1a1a] bg-[#1a1a1a] object-cover"
        />
      ))}
    </div>
  );
}
