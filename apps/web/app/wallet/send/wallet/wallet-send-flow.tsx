"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../../components/app/icons";
import { cleanAmount, formatUsd, toTokenUnits } from "../../../lib/money";
import {
  walletAddress,
  walletAddressError,
  shortWalletAddress,
  type WalletNetwork,
} from "../../../lib/wallet-send-address";
import { SendNeedsReviewError, sendFromVault } from "../../../lib/wallet-send-transfer";
import { walletApi, type WalletSend } from "../../../lib/wallet-api";
import { keys, useMe, useVault } from "../../../lib/wallet-queries";

type Step = "network" | "address" | "amount" | "review" | "done";
const networkNames: Record<WalletNetwork, string> = { near: "NEAR", solana: "Solana", base: "Base" };

export function WalletSendFlow() {
  const me = useMe();
  const vault = useVault();
  const queryClient = useQueryClient();
  const networks = useQuery({ queryKey: ["send-networks"], queryFn: walletApi.sendNetworks, retry: false });
  const [step, setStep] = useState<Step>("network");
  const [chain, setChain] = useState<WalletNetwork>("near");
  const [typedAddress, setTypedAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [onWay, setOnWay] = useState(false);
  const [nearTx, setNearTx] = useState<string | null>(null);
  const [sent, setSent] = useState<WalletSend | null>(null);
  const [quotedRequest, setQuotedRequest] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const address = walletAddress(typedAddress, chain);
  const addressError = walletAddressError(address, chain);
  const network = networks.data?.networks.find((item) => item.chain === chain && item.token === "usdc");
  const minimum = chain === "near" ? "0.01" : network?.minimum;
  const amountUnits = amount ? toTokenUnits(amount) : 0n;
  const amountError =
    !amount || amountUnits === 0n
      ? "Enter an amount."
      : minimum && amountUnits < toTokenUnits(minimum)
        ? `Minimum on ${networkNames[chain]} is ${formatUsd(minimum)}.`
        : vault.data && amountUnits > toTokenUnits(vault.data.available)
          ? `You have ${formatUsd(vault.data.available)} available.`
          : null;

  const quote = useMutation({
    mutationFn: ({ key, idempotency }: { key: string; idempotency: string }) => {
      const [chosenChain, chosenAddress, chosenAmount] = JSON.parse(key) as [WalletNetwork, string, string];
      return walletApi.createSend(
        { chain: chosenChain, address: chosenAddress, amount: chosenAmount },
        idempotency,
      );
    },
  });
  const currentRequest = JSON.stringify([chain, address, amount]);
  const validQuote =
    quote.data && quotedRequest === currentRequest && Date.parse(quote.data.deposit.expires_at) > now + 60_000
      ? quote.data
      : null;
  const status = useQuery({
    queryKey: ["send", sent?.send_id],
    queryFn: () => walletApi.send(sent!.send_id),
    enabled: onWay && Boolean(sent),
    refetchInterval: (query) =>
      ["delivered", "refunded", "failed", "expired"].includes(query.state.data?.state ?? "") ? false : 3_000,
    retry: false,
  });
  const latest = status.data ?? sent;

  useEffect(() => {
    if (!quote.data) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quote.data]);

  useEffect(() => {
    if (latest && ["delivered", "refunded", "failed"].includes(latest.state)) {
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    }
  }, [latest, queryClient]);

  function review() {
    if (addressError || amountError || (chain !== "near" && !network?.available)) return;
    setStep("review");
    if (chain === "near" || validQuote || quote.isPending) return;
    setQuotedRequest(currentRequest);
    quote.mutate({ key: currentRequest, idempotency: crypto.randomUUID() });
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!me.data || !me.data.near_account || addressError || amountError)
        throw new Error("Check the wallet and amount again.");
      if (address === me.data.near_account || address === me.data.vault)
        throw new Error("Choose a wallet outside your fliq account.");
      if (chain !== "near" && !validQuote) throw new Error("This quote expired. Review it again.");
      const destination = chain === "near" ? address : validQuote!.deposit.address;
      const result = await sendFromVault(me.data, destination, amount, () => {
        setOnWay(true);
        setStep("done");
        if (chain !== "near") setSent(validQuote!);
      });
      return result;
    },
    onSuccess: (result) => {
      setNearTx(result.tx_hash ?? null);
      setOnWay(true);
      setStep("done");
      void queryClient.invalidateQueries({ queryKey: keys.vault });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="head">
        <h1>{step === "done" ? "Your send" : "Send to a wallet"}</h1>
      </div>
      {step === "network" && (
        <section className="card pad stack">
          <p className="muted">Choose where the wallet lives.</p>
          {(["near", "solana", "base"] as const).map((choice) => {
            const offered = networks.data?.networks.find(
              (item) => item.chain === choice && item.token === "usdc",
            );
            return (
              <button
                key={choice}
                type="button"
                className="btn line lg block"
                disabled={choice !== "near" && (!offered || !offered.available)}
                onClick={() => {
                  setChain(choice);
                  setTypedAddress("");
                  setStep("address");
                }}
              >
                {networkNames[choice]} {choice !== "near" && !offered?.available ? "· unavailable" : ""}
              </button>
            );
          })}
          {networks.isError && (
            <p role="alert" className="err">
              Could not load Solana and Base availability. Try again later.
            </p>
          )}
        </section>
      )}
      {step === "address" && (
        <section className="card pad stack">
          <label className="flabel" htmlFor="wallet-address">
            {networkNames[chain]} wallet address
          </label>
          <input
            id="wallet-address"
            className="field"
            value={typedAddress}
            onChange={(event) => setTypedAddress(event.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Paste the wallet address"
          />
          {typedAddress && addressError && (
            <p role="alert" className="err">
              {addressError}
            </p>
          )}
          <div className="row2">
            <button className="btn line lg" onClick={() => setStep("network")}>
              Back
            </button>
            <button className="btn ink lg" disabled={Boolean(addressError)} onClick={() => setStep("amount")}>
              Next
            </button>
          </div>
        </section>
      )}
      {step === "amount" && (
        <section className="card pad stack">
          <p>
            To {networkNames[chain]} wallet {shortWalletAddress(address)}
          </p>
          <label className="flabel" htmlFor="wallet-amount">
            USDC amount
          </label>
          <input
            id="wallet-amount"
            className="field"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(cleanAmount(event.target.value))}
            placeholder="0.00"
          />
          {amount && amountError && (
            <p role="alert" className="err">
              {amountError}
            </p>
          )}
          <p className="hint">
            Available: {vault.data ? formatUsd(vault.data.available) : "Loading…"}
            {minimum ? ` · Minimum: ${formatUsd(minimum)}` : ""}
          </p>
          <div className="row2">
            <button className="btn line lg" onClick={() => setStep("address")}>
              Back
            </button>
            <button
              className="btn ink lg"
              disabled={Boolean(amountError) || !vault.data || (chain !== "near" && !network?.available)}
              onClick={review}
            >
              Review
            </button>
          </div>
        </section>
      )}
      {step === "review" && (
        <section className="card pad stack">
          <h2>Review your send</h2>
          <p>
            {formatUsd(amount)} to {networkNames[chain]} wallet {shortWalletAddress(address)}
          </p>
          {chain !== "near" && quote.isPending && <p role="status">Checking the network fee…</p>}
          {chain !== "near" && quote.isError && (
            <p role="alert" className="err">
              {quote.error.message}
            </p>
          )}
          {chain !== "near" && !validQuote && !quote.isPending && (
            <button className="btn line lg" onClick={review}>
              Get a new quote
            </button>
          )}
          {(chain === "near" || validQuote) && (
            <>
              <dl className="kv">
                <div>
                  <dt>Network fee</dt>
                  <dd>{validQuote ? formatUsd(validQuote.fee) : "Free"}</dd>
                </div>
                <div>
                  <dt>They receive</dt>
                  <dd>{formatUsd(validQuote?.receives ?? amount)} USDC</dd>
                </div>
                <div>
                  <dt>Arrival</dt>
                  <dd>{chain === "near" ? "A few seconds" : `About ${validQuote!.eta_seconds} seconds`}</dd>
                </div>
              </dl>
              <div className="row2">
                <button className="btn line lg" disabled={submit.isPending} onClick={() => setStep("amount")}>
                  Back
                </button>
                <button
                  className="btn ink lg"
                  disabled={
                    submit.isPending ||
                    submit.error instanceof SendNeedsReviewError ||
                    Boolean(amountError) ||
                    Boolean(addressError)
                  }
                  onClick={() => submit.mutate()}
                >
                  <Icon name="finger" size={18} /> Sign and send
                </button>
              </div>
            </>
          )}
          {submit.isPending && <p role="status">Signing and sending from your vault…</p>}
          {submit.isError && (
            <p role="alert" className="err">
              {submit.error.message}
            </p>
          )}
        </section>
      )}
      {step === "done" && (
        <section className="card pad stack">
          <h2>
            {latest?.state === "delivered" || (chain === "near" && submit.isSuccess)
              ? "Sent"
              : latest && ["refunded", "failed"].includes(latest.state)
                ? "Not delivered. Your money is back"
                : "On its way"}
          </h2>
          <p>
            {formatUsd(latest?.receives ?? amount)} to {networkNames[chain]} wallet{" "}
            {shortWalletAddress(address)}
          </p>
          <p className="muted">You don&apos;t need to wait here. Activity will update as it moves.</p>
          {latest?.state === "delivered" && latest.destination_tx && (
            <a
              className="btn line lg"
              target="_blank"
              rel="noopener noreferrer"
              href={
                chain === "solana"
                  ? `https://solscan.io/tx/${encodeURIComponent(latest.destination_tx)}`
                  : `https://basescan.org/tx/${encodeURIComponent(latest.destination_tx)}`
              }
            >
              View transaction
            </a>
          )}
          {chain === "near" && nearTx && (
            <a
              className="btn line lg"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://nearblocks.io/txns/${encodeURIComponent(nearTx)}`}
            >
              View on NEAR
            </a>
          )}
          {submit.isError && (
            <p role="alert" className="err">
              {submit.error.message}
            </p>
          )}
          <Link className="btn ink lg" href="/wallet">
            Done
          </Link>
        </section>
      )}
    </div>
  );
}
