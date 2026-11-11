"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CopyButton } from "../components/copy-button";

export function CodeBlock({ text, children }: { text: string; children?: ReactNode }) {
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ output: string; error: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const source = edited ?? text;
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setResult(null);
    try {
      const { runPlayground } = await import("./run-playground");
      const output = await runPlayground(source, current.signal);
      if (!current.signal.aborted) setResult({ output, error: false });
    } catch (error) {
      if (!current.signal.aborted)
        setResult({ output: error instanceof Error ? error.message : "Unable to run example.", error: true });
    } finally {
      if (!current.signal.aborted) setRunning(false);
    }
  }

  const buttonClass =
    "cursor-pointer rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:cursor-wait disabled:opacity-50";
  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-[#0f0f0f] text-[#e5e5e5]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-[11px] text-zinc-400">Playground · test data</span>
        <div className="flex items-center gap-2">
          <CopyButton text={source} />
          <button
            type="button"
            className={buttonClass}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Preview" : "Edit"}
          </button>
          {edited !== null && (
            <button
              type="button"
              className={buttonClass}
              disabled={running}
              onClick={() => {
                setEdited(null);
                setResult(null);
              }}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            className={`${buttonClass} bg-white text-black hover:bg-zinc-200`}
            disabled={running}
            onClick={run}
          >
            {running ? "Running…" : "Run ▶"}
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          aria-label="Editable code example"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={source}
          maxLength={30_000}
          rows={Math.min(24, Math.max(5, source.split("\n").length + 1))}
          onChange={(event) => {
            setEdited(event.target.value);
            setResult(null);
          }}
          disabled={running}
          className="block w-full resize-y bg-transparent px-[18px] py-4 font-[family-name:var(--font-docs-mono)] text-[12px] leading-[1.6] text-[#e5e5e5] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
        />
      ) : (
        <pre className="m-0 overflow-x-auto px-[18px] py-4 font-[family-name:var(--font-docs-mono)] text-[12px] leading-[1.6] whitespace-pre">
          <code>{edited === null ? (children ?? text) : source}</code>
        </pre>
      )}
      <p className="border-t border-white/10 px-3 py-2 text-[10px] leading-4 text-zinc-400">
        Run JSON, curl or JavaScript with local test responses. No real API calls. Install commands and server
        integrations need your terminal.
      </p>
      {result && (
        <div
          role={result.error ? "alert" : "status"}
          className={`border-t border-white/10 px-4 py-3 ${result.error ? "text-red-300" : "text-emerald-300"}`}
        >
          <p className="mb-2 text-[11px] font-semibold">{result.error ? "Error" : "Result"}</p>
          <pre className="max-h-80 overflow-auto font-mono text-[11px] leading-5 whitespace-pre-wrap break-words">
            {result.output}
          </pre>
        </div>
      )}
    </div>
  );
}
