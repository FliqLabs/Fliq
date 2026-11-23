"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/app/icons";
import { Drawer, Notice } from "../components/app/ui";
import { CURRENCIES, countryOf, type LocalCurrency } from "../lib/money";
import { rememberNumber } from "../lib/saved-accounts";
import { walletApi, type Recipient, type VerifiedAccount } from "../lib/wallet-api";
import { keys, useInstitutions } from "../lib/wallet-queries";

export const LIVE_CURRENCIES: LocalCurrency[] = ["NGN", "KES"];

const NUMBER_LENGTH = { bank: 10, mobile_money: 10 } as const;

export type SavedAccount = { recipient: Recipient; verified: VerifiedAccount; currency: LocalCurrency };

export function AddRecipientDrawer({
  onClose,
  onSaved,
  cta = "Save recipient",
}: {
  onClose: () => void;
  onSaved: (saved: SavedAccount) => void;
  cta?: string;
}) {
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState<LocalCurrency>("NGN");
  const [bank, setBank] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [bankQuery, setBankQuery] = useState("");
  const [number, setNumber] = useState("");
  const bankRef = useRef<HTMLDivElement>(null);
  const institutions = useInstitutions(countryOf(currency));
  const options = institutions.data?.items ?? [];
  const institution = options.find((item) => item.code === bank) ?? null;
  const mobile = institution?.type === "mobile_money";
  const complete = !!institution && number.length >= NUMBER_LENGTH[institution.type];

  const filtered = bankQuery.trim()
    ? options.filter((item) => item.name.toLowerCase().includes(bankQuery.toLowerCase()))
    : options;

  useEffect(() => {
    if (!bankOpen) return;
    function onDown(e: MouseEvent) {
      if (bankRef.current && !bankRef.current.contains(e.target as Node)) setBankOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [bankOpen]);

  const verify = useMutation({
    mutationFn: () => walletApi.verifyAccount({ bank: institution!.code, number, country: countryOf(currency) }),
  });
  const save = useMutation({
    mutationFn: () => walletApi.saveRecipient({ bank: institution!.code, number, country: countryOf(currency) }),
    onSuccess: (recipient) => {
      rememberNumber(recipient.recipient_id, number);
      queryClient.invalidateQueries({ queryKey: keys.recipients });
      onSaved({ recipient, verified: verify.data!, currency });
    },
  });

  const { mutate: check, reset } = verify;
  useEffect(() => {
    reset();
    if (!complete) return;
    const timer = setTimeout(() => check(), 350);
    return () => clearTimeout(timer);
  }, [complete, number, institution?.code, check, reset]);

  return (
    <Drawer
      title="New recipient"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn line lg" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn ink lg"
            disabled={!verify.isSuccess || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving" : cta}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="rcp-country">Country</label>
        <select
          className="inp"
          id="rcp-country"
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value as LocalCurrency);
            setBank("");
            setBankOpen(false);
            setBankQuery("");
            setNumber("");
          }}
        >
          {(Object.keys(CURRENCIES) as LocalCurrency[]).map((code) => (
            <option key={code} value={code} disabled={!LIVE_CURRENCIES.includes(code)}>
              {CURRENCIES[code].country}
              {LIVE_CURRENCIES.includes(code) ? "" : " · soon"}
            </option>
          ))}
        </select>
      </div>
      <div className="field" ref={bankRef}>
        <label htmlFor="rcp-bank-trigger">Bank or wallet</label>
        {!bankOpen ? (
          <button
            type="button"
            id="rcp-bank-trigger"
            className="inp"
            disabled={!options.length}
            onClick={() => setBankOpen(true)}
            style={{ display: "flex", alignItems: "center", cursor: "pointer", textAlign: "left" }}
          >
            {institutions.isPending ? (
              <span style={{ flex: 1, color: "var(--muted)" }}>Loading…</span>
            ) : institution ? (
              <span style={{ flex: 1 }}>{institution.name}</span>
            ) : (
              <span style={{ flex: 1, color: "var(--muted)" }}>Select a bank or wallet</span>
            )}
            <span style={{ color: "var(--muted)", lineHeight: 0 }}>
              <Icon name="chevR" size={16} />
            </span>
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="search">
              <Icon name="search" size={16} />
              <input
                autoFocus
                value={bankQuery}
                onChange={(e) => setBankQuery(e.target.value)}
                placeholder="Search banks and wallets"
                aria-label="Search banks and wallets"
              />
              {bankQuery && (
                <button type="button" onClick={() => setBankQuery("")} aria-label="Clear search" style={{ lineHeight: 0, color: "var(--muted)" }}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
            <div
              className="rows"
              style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line2)", borderRadius: 12, padding: "4px 8px" }}
            >
              {filtered.length === 0 && (
                <div className="empty" style={{ padding: "12px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
                  No results for &ldquo;{bankQuery}&rdquo;
                </div>
              )}
              {filtered.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className="row"
                  onClick={() => {
                    setBank(item.code);
                    setBankOpen(false);
                    setBankQuery("");
                    setNumber("");
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="rcp-number">{mobile ? "Phone number" : "Account number"}</label>
        <input
          className="inp num"
          id="rcp-number"
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          placeholder={mobile ? "0712 448 412" : "10 digits"}
          value={number}
          onChange={(event) => setNumber(event.target.value.replace(/\D/g, ""))}
        />
      </div>
      {verify.isPending && <Notice icon="spin">Checking with {institution?.name}</Notice>}
      {verify.isError && <Notice tone="bad">{verify.error.message}</Notice>}
      {verify.isSuccess && (
        <div className="verified">
          <Icon name="check" size={22} />
          <div>
            <b>{verify.data.account_name}</b>
            <span>Name on the {verify.data.institution || institution?.name} account</span>
          </div>
        </div>
      )}
      {save.isError && <Notice tone="bad">{save.error.message}</Notice>}
    </Drawer>
  );
}
