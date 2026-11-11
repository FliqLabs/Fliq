import type { ReactNode } from "react";
import { CopyButton } from "../components/copy-button";

export function CodeBlock({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="group relative min-w-0 overflow-hidden rounded-xl bg-[#0f0f0f] text-[#e5e5e5]">
      <div className="absolute top-2 right-2 z-10 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <CopyButton text={text} />
      </div>
      <pre className="m-0 overflow-x-auto px-[18px] py-4 pr-24 font-[family-name:var(--font-docs-mono)] text-[12px] leading-[1.6] whitespace-pre">
        <code>{children ?? text}</code>
      </pre>
    </div>
  );
}
