"use client";

import { useEffect, useState } from "react";
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
  const [number, setNumber] = useState("");
  const institutions = useInstitutions(countryOf(currency));
  const options = institutions.data?.items ?? [];
  const institution = options.find((item) => item.code === bank) ?? options[0];
  const mobile = institution?.type === "mobile_money";
  const complete = institution && number.length >= NUMBER_LENGTH[institution.type];

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
      <div className="field">
        <label htmlFor="rcp-bank">Bank or wallet</label>
        <select
          className="inp"
          id="rcp-bank"
          value={institution?.code ?? ""}
          disabled={!options.length}
          onChange={(event) => {
            setBank(event.target.value);
            setNumber("");
          }}
        >
          {institutions.isPending && <option>Loading banks</option>}
          {options.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
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
