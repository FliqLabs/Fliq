import Link from "next/link";
import { CodeBlock } from "../code-block";
import { apiOperations } from "./api-operations";

export default function ApiContent() {
  const tags = [...new Set(apiOperations.map((operation) => operation.tag))];
  return (
    <>
      <div className="flex flex-col gap-3.5">
        <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.03em]">API reference</h1>
        <p className="text-sm leading-6 text-[#6b6b6b]">
          One base URL, Bearer keys, JSON in and out. Sandbox and live use different keys. The endpoints below
          follow the repository’s OpenAPI contract.
        </p>
        <div className="flex flex-wrap gap-2.5 text-[12px] font-semibold">
          <a
            download
            href="/docs/openapi.yaml"
            className="rounded-[10px] border border-[#e6e6e6] px-3.5 py-2.5"
          >
            Download OpenAPI
          </a>
          <a
            download
            href="/docs/fliq.postman_collection.json"
            className="rounded-[10px] border border-[#e6e6e6] px-3.5 py-2.5"
          >
            Postman collection
          </a>
          <Link href="/docs/sdk" className="rounded-[10px] border border-[#e6e6e6] px-3.5 py-2.5">
            TypeScript SDK
          </Link>
        </div>
        <CodeBlock
          text={
            "# Base URL\nhttps://fliq-yclq.onrender.com/v1\n\nAuthorization: Bearer <YOUR_API_KEY>\nContent-Type: application/json\nIdempotency-Key: <UNIQUE_REQUEST_KEY>"
          }
        />
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Endpoints</h2>
        <p className="text-[13px] leading-6 text-[#6b6b6b]">
          Expand an endpoint for its authentication, parameters and response codes. Public endpoints need no
          key; authenticated requests are scoped to the current user or workspace.
        </p>
        <div className="overflow-hidden rounded-[14px] border border-[#e6e6e6]">
          {tags.map((tag) => (
            <section key={tag}>
              <h3 className="border-b border-[#e6e6e6] bg-[#f6f6f6] px-4 py-2.5 text-[11px] font-semibold tracking-wide text-[#6b6b6b] uppercase">
                {tag}
              </h3>
              {apiOperations
                .filter((operation) => operation.tag === tag)
                .map((operation) => (
                  <details
                    key={`${operation.method} ${operation.path}`}
                    className="border-b border-[#e6e6e6] last:border-b-0"
                  >
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3 text-[13px] hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-blue-600">
                      <span
                        className={`inline-flex w-[58px] shrink-0 items-center justify-center rounded-md py-1 text-[11px] font-bold tracking-wide ${operation.method === "GET" ? "bg-[#e6f4ea] text-[#1b7a3a]" : "bg-[#eef2ff] text-[#3730a3]"}`}
                      >
                        {operation.method}
                      </span>
                      <code className="min-w-0 break-all text-[12px]">{operation.path}</code>
                      <span className="w-full text-[#6b6b6b] sm:w-auto sm:flex-1">{operation.summary}</span>
                      <span aria-hidden="true" className="ml-auto text-zinc-400">
                        ⌄
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-[#e6e6e6] bg-zinc-50 px-4 py-4 text-[12px] leading-6">
                      <p>
                        <strong>Authentication:</strong>{" "}
                        {operation.public
                          ? "Public · no key required"
                          : "Bearer API key or signed-in session, as defined by the operation"}
                      </p>
                      {operation.parameters.length > 0 && (
                        <p>
                          <strong>Parameters:</strong> {operation.parameters.join(", ")}
                        </p>
                      )}
                      {operation.requestSchema && (
                        <p>
                          <strong>JSON body:</strong> <code>{operation.requestSchema}</code> — see the
                          downloadable OpenAPI file for required fields and types.
                        </p>
                      )}
                      <p>
                        <strong>Response codes:</strong> {operation.responses.join(", ")}
                      </p>
                      <CodeBlock
                        text={`curl -X ${operation.method} "https://fliq-yclq.onrender.com${operation.path}"${operation.public ? "" : ' \\\n  -H "Authorization: Bearer <YOUR_API_KEY>"'}${operation.requestSchema ? " \\\n  -H \"Content-Type: application/json\" \\\n  -d '<JSON_BODY_FROM_OPENAPI>'" : ""}`}
                      />
                    </div>
                  </details>
                ))}
            </section>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-[#e6e6e6] p-5 text-[13px] leading-6 text-[#6b6b6b]">
        <h2 className="mb-2 font-semibold text-zinc-950">Contract and deployment</h2>
        <p>
          The API contract describes the supported request shapes. Some handlers are still being connected in
          the deployed sandbox. Check your response before enabling a live workflow.
        </p>
        <Link href="/docs/errors" className="mt-3 inline-block font-semibold text-zinc-950">
          Read the error guide →
        </Link>
      </section>
    </>
  );
}
