"use client";

import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { countries, CountrySelect } from "./country-select";
import yellowIcon from "./yellow icon.png";
import flashIcon from "./flash image.png";
import blueStarIcon from "./blue star.png";
import usdcIcon from "./usdc.png";
import documentIcon from "./google-docs.png";
import { PdfDocuments, documentRequirements } from "./pdf-documents";
import type { FormEvent } from "react";
import { type BusinessDraft, useKybFiles, useKybDecision, businessIsComplete } from "./kyb-state";
import { DocumentGuidance } from "./document-guidance";
import { KybReview, ReviewGuidance } from "./kyb-review";
import { KybStatus } from "./kyb-status";
import { ApiError, fliqApi, type User } from "../../lib/fliq-api";

const emptyDraft: BusinessDraft = {
  legalName: "",
  registration: "",
  country: "ng",
  website: "",
  purpose: "",
  volume: "",
  corridors: [],
};
const documents = documentRequirements;
const comparison = [
  ["Keys", "rt_test_", "rt_live_"],
  ["Money", "Test USDC", "USDC on Base, Solana, NEAR"],
  ["Providers", "Mocked quotes", "Best of 3 live"],
  ["Vault caps", "$150 per payout, $500 a day", "You set them at approval, on NEAR"],
  ["Webhooks", "Signed, retried 24h", "Same secret, same shape"],
  ["Fee", "Free", "0.5% above $50k a month"],
];
const fieldClass =
  "mt-2 w-full rounded-lg border border-[#e6e6e6] bg-white px-3 py-2.5 text-sm font-normal outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-800 focus:ring-1 focus:ring-zinc-800";
const primaryClass =
  "cursor-pointer rounded-lg bg-[#111111] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-40";

export function GoLiveForm() {
  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  if (account.isPending)
    return (
      <p role="status" className="text-sm text-zinc-500">
        Loading your workspace…
      </p>
    );
  if (account.error instanceof ApiError && account.error.status === 401)
    return (
      <Link href="/sign-in" className="text-sm underline">
        Sign in to prepare your business application
      </Link>
    );
  if (account.isError)
    return (
      <p role="alert" className="text-sm text-red-700">
        {account.error.message}
      </p>
    );
  return <BusinessPreview key={account.data.user_id} userId={account.data.user_id} />;
}

function BusinessPreview({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const stageKey = ["kyb-stage", userId];
  const { data: step = 0 } = useQuery<number>({
    queryKey: stageKey,
    initialData: 0,
    queryFn: skipToken,
    enabled: false,
    gcTime: Infinity,
  });
  const setStep = (value: number) => queryClient.setQueryData(stageKey, value);
  const { files } = useKybFiles(userId);
  const { decision, setDecision } = useKybDecision(userId);
  const draftKey = ["kyb-draft", userId];
  const { data: draft = emptyDraft } = useQuery({
    queryKey: draftKey,
    initialData: emptyDraft,
    queryFn: skipToken,
    enabled: false,
    gcTime: Infinity,
  });
  function update(patch: Partial<BusinessDraft>) {
    queryClient.setQueryData<BusinessDraft>(draftKey, { ...draft, ...patch });
  }
  function continueToDocuments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStep(1);
  }

  function submitPreview(keepSandbox: boolean) {
    if (!businessIsComplete(draft) || !documentRequirements.every((_, index) => files[index])) return;
    setDecision({ status: "in_review", submittedAt: new Date().toISOString(), keepSandbox });
    setStep(3);
  }

  return (
    <main>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-[34px] font-bold tracking-tight">
            {step === 4 ? "You are live · sandbox preview" : "Go live with fliq"}
          </h1>
          <p className="mt-3 max-w-[690px] text-sm leading-6 text-[#6b6b6b]">
            Live keys move real money, so we check who you are first. Most reviews close in 1 to 2 business
            days.
          </p>
        </div>
        <span className="rounded-md bg-[#fff3d6] px-3 py-2 text-xs font-bold text-[#8a5a00]">
          Sandbox KYB preview · reviews are mocked
        </span>
      </div>
      {step >= 3 ? (
        <KybStatus
          decision={decision}
          draft={draft}
          fileCount={Object.keys(files).length}
          onEdit={() => setStep(0)}
          onApprove={() => {
            setDecision({ ...decision, status: "approved", approvedAt: new Date().toISOString() });
            setStep(4);
          }}
        />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)]">
          <div className="min-w-0">
            <section
              className="overflow-hidden rounded-xl border border-[#e6e6e6]"
              aria-label="Business verification preview"
            >
              <ol className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e6e6e6] bg-[#fafafa] px-6 py-5 text-xs sm:text-[13px]">
                {["Business", "Documents", "Review and submit"].map((label, index) => (
                  <li
                    key={label}
                    aria-current={step === index ? "step" : undefined}
                    className={`flex items-center gap-2 ${step === index ? "font-bold text-zinc-950" : "text-[#6b6b6b]"}`}
                  >
                    <span
                      className={`flex size-6 items-center justify-center rounded-full ${step === index ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white"}`}
                    >
                      {index + 1}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
              {step === 0 ? (
                <form onSubmit={continueToDocuments} className="space-y-6 p-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="text-[13px] font-bold">
                      Legal business name
                      <input
                        required
                        autoComplete="organization"
                        value={draft.legalName}
                        onChange={(event) => update({ legalName: event.target.value })}
                        placeholder="Fliq Payments Ltd"
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-[13px] font-bold">
                      Registration number
                      <input
                        required
                        value={draft.registration}
                        onChange={(event) => update({ registration: event.target.value })}
                        placeholder="RC 0000000"
                        className={fieldClass}
                      />
                    </label>
                    <CountrySelect value={draft.country} onChange={(country) => update({ country })} />
                    <label className="text-[13px] font-bold">
                      Website
                      <input
                        required
                        value={draft.website}
                        onChange={(event) => update({ website: event.target.value })}
                        placeholder="fliq.money"
                        autoComplete="url"
                        className={fieldClass}
                      />
                    </label>
                  </div>
                  <label className="block text-[13px] font-bold">
                    What are you paying out for?
                    <textarea
                      required
                      rows={3}
                      value={draft.purpose}
                      onChange={(event) => update({ purpose: event.target.value })}
                      placeholder="Contractor payroll for remote teams in Nigeria and Kenya"
                      aria-describedby="purpose-help"
                      className={`${fieldClass} resize-y`}
                    />
                    <span
                      id="purpose-help"
                      className="mt-2 block text-xs leading-5 font-normal text-[#6b6b6b]"
                    >
                      One sentence is enough. It decides which providers we open for you.
                    </span>
                  </label>
                  <fieldset>
                    <legend className="mb-3 text-[13px] font-bold">Expected monthly volume</legend>
                    <div className="flex flex-wrap gap-2">
                      {["Under $10k", "$10k to $50k", "$50k to $250k", "Over $250k"].map((volume) => (
                        <label key={volume} className="cursor-pointer">
                          <input
                            type="radio"
                            required
                            name="volume"
                            value={volume}
                            checked={draft.volume === volume}
                            onChange={() => update({ volume })}
                            className="peer sr-only"
                          />
                          <span className="block rounded-lg border border-[#e6e6e6] px-3 py-2.5 text-xs peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                            {volume}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-3 text-[13px] font-bold">Corridors to open</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-3">
                      {countries.map(({ corridor: value, corridorLabel: label, icon }) => (
                        <label key={value} className="flex cursor-pointer items-start gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            checked={draft.corridors.includes(value)}
                            onChange={(event) =>
                              update({
                                corridors: event.target.checked
                                  ? [...draft.corridors, value]
                                  : draft.corridors.filter((item) => item !== value),
                              })
                            }
                            className="mt-0.5 size-4 accent-zinc-950"
                          />
                          <Image
                            src={usdcIcon}
                            alt="USDC to"
                            className="size-5 shrink-0 rounded-full object-contain"
                          />
                          <Image src={icon} alt="" className="size-5 shrink-0 rounded-full object-contain" />
                          <span>
                            {label}
                            {value === "ghs" && (
                              <span className="block text-xs text-[#6b6b6b]">· Bitnob, sandbox only</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e6e6e6] pt-5">
                    <p className="text-xs text-[#6b6b6b]">Saved as you type for this session.</p>
                    <button type="submit" className={primaryClass}>
                      Continue to documents
                    </button>
                  </div>
                </form>
              ) : step === 1 ? (
                <PdfDocuments userId={userId} onBack={() => setStep(0)} onContinue={() => setStep(2)} />
              ) : (
                <KybReview
                  draft={draft}
                  files={files}
                  onEditBusiness={() => setStep(0)}
                  onEditDocuments={() => setStep(1)}
                  onSubmit={submitPreview}
                />
              )}
            </section>
            {step < 2 && (
              <section className="mt-5 rounded-xl border border-[#e6e6e6] p-6">
                <h2 className="text-sm font-bold">Documents you will need in step 2</h2>
                <ul className="mt-4 grid gap-x-6 gap-y-3 text-[13px] text-[#6b6b6b] sm:grid-cols-2">
                  {documents.map((document) => (
                    <li key={document} className="flex gap-2">
                      <Image src={documentIcon} alt="" className="size-5 shrink-0 object-contain" />
                      {document}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          {step === 1 ? (
            <DocumentGuidance />
          ) : step === 2 ? (
            <ReviewGuidance />
          ) : (
            <aside className="rounded-xl border border-[#e6e6e6] p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">What live unlocks</h2>
                <span className="rounded-md bg-[#f6f6f6] px-2 py-1 text-xs text-[#6b6b6b]">Not started</span>
              </div>
              <table className="mt-5 w-full table-fixed text-left text-xs leading-5">
                <caption className="sr-only">Sandbox and live features</caption>
                <thead>
                  <tr className="text-[10px] tracking-wider text-[#6b6b6b]">
                    <th className="w-[24%] pb-3">
                      <span className="sr-only">Feature</span>
                    </th>
                    <th className="w-[33%] pb-3 font-medium">SANDBOX</th>
                    <th className="pb-3 font-medium">LIVE</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map(([label, sandbox, live]) => (
                    <tr key={label} className="border-t border-[#e6e6e6]">
                      <th scope="row" className="py-3 pr-2 align-top font-medium">
                        {label}
                      </th>
                      <td className="py-3 pr-3 align-top text-[#6b6b6b]">{sandbox}</td>
                      <td className="py-3 align-top">
                        {live}
                        {label === "Providers" && (
                          <span className="mt-2 flex items-center gap-1.5" aria-label="Three live providers">
                            {[yellowIcon, flashIcon, blueStarIcon].map((icon, index) => (
                              <Image
                                key={index}
                                src={icon}
                                alt=""
                                className="size-[22px] shrink-0 object-contain"
                              />
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <section className="mt-4 border-t border-[#e6e6e6] pt-5">
                <h2 className="text-sm font-bold">What happens after you submit</h2>
                <p className="mt-4 text-[13px] leading-6 text-[#6b6b6b]">
                  <strong className="font-semibold text-zinc-950">In review</strong>, 1 to 2 business days.
                  Your sandbox keeps working the whole time.
                </p>
                <p className="mt-3 text-[13px] leading-6 text-[#6b6b6b]">
                  <strong className="font-semibold text-zinc-950">Approved:</strong> you pick your vault caps,
                  we open the providers for your corridors, and a live key appears on API keys.
                </p>
                <p className="mt-4 rounded-lg bg-[#fff3d6] p-3 text-xs leading-5 text-[#8a5a00]">
                  The first live payout is capped at $500 for 48 hours, whatever caps you set.
                </p>
                <p className="mt-4 text-xs leading-5 text-[#6b6b6b]">
                  This preview does not submit documents, start a review, or enable live payouts.
                </p>
              </section>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
