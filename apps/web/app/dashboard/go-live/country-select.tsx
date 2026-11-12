"use client";

import Image from "next/image";
import { useRef } from "react";
import nigeria from "./nigeria Logo.png";
import kenya from "./kenya new.png";
import ghana from "./ghana new.png";

export const countries = [
  { value: "ng", name: "Nigeria", icon: nigeria, corridor: "ngn", corridorLabel: "NGN bank and mobile" },
  { value: "ke", name: "Kenya", icon: kenya, corridor: "kes", corridorLabel: "KES M-Pesa" },
  { value: "gh", name: "Ghana", icon: ghana, corridor: "ghs", corridorLabel: "GHS mobile money" },
];

export function CountrySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  const selected = countries.find((country) => country.value === value);

  return (
    <div>
      <p id="country-label" className="text-[13px] font-bold">
        Country of incorporation
      </p>
      <input type="hidden" name="country" value={value} />
      <details
        ref={details}
        className="relative mt-2 text-sm font-normal"
        onKeyDown={(event) => {
          if (event.key === "Escape" && details.current) {
            details.current.open = false;
            details.current.querySelector("summary")?.focus();
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && details.current)
            details.current.open = false;
        }}
      >
        <summary
          aria-labelledby="country-label country-value"
          className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-app-line bg-app-panel px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-app-accent [&::-webkit-details-marker]:hidden"
        >
          {selected && (
            <Image src={selected.icon} alt="" className="size-5 shrink-0 rounded-full object-contain" />
          )}
          <span id="country-value">{selected?.name ?? "Other"}</span>
          <span aria-hidden="true" className="ml-auto text-app-muted">
            ⌄
          </span>
        </summary>
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-app-line bg-app-panel p-1 shadow-lg">
          {[...countries, { value: "other", name: "Other", icon: null }].map((country) => (
            <button
              key={country.value}
              type="button"
              aria-pressed={value === country.value}
              onClick={() => {
                onChange(country.value);
                if (details.current) {
                  details.current.open = false;
                  details.current.querySelector("summary")?.focus();
                }
              }}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-app-hover focus-visible:outline-2 ${value === country.value ? "bg-app-hover" : ""}`}
            >
              {country.icon ? (
                <Image src={country.icon} alt="" className="size-5 shrink-0 rounded-full object-contain" />
              ) : (
                <span aria-hidden="true" className="size-5" />
              )}
              {country.name}
              {value === country.value && (
                <span aria-hidden="true" className="ml-auto">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
