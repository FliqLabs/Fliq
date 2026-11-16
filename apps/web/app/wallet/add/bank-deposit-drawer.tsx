"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer, Notice, Spinner } from "../../components/app/ui";
import { decimalText, depositIsFinal, formatNaira, isCompleteBankDetails, isPositiveDecimal, pajApi, parseNaira, recordBankDeposit, usdcAmountAtLeastMinimum, type PajOrder, type PajSession } from "../../lib/paj";
import { walletApi, type DepositSource } from "../../lib/wallet-api";
import { keys, useMe } from "../../lib/wallet-queries";

type Step = "amount" | "email" | "code" | "pay" | "receiving";

function orderDetails(order: PajOrder) {
  return { accountNumber: order.accountNumber ?? "", accountName: order.accountName ?? "", bank: order.bank ?? "" };
}

export function BankDepositDrawer({ source, onClose }: { source: DepositSource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState<PajSession | null>(null);
  const [order, setOrder] = useState<PajOrder | null>(null);
  const [depositId, setDepositId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState({ accountNumber: "", accountName: "", bank: "" });
  const depositKey = useRef<string | null>(null);
  const [orderAttempted, setOrderAttempted] = useState(false);
  const me = useMe();
  const owner = me.data?.user_id ?? me.data?.near_account ?? null;

  const parsed = parseNaira(amount);
  const quote = useQuery({
    queryKey: ["paj-quote", parsed],
    queryFn: () => pajApi.quote(parsed, session!),
    enabled: Boolean(session && isPositiveDecimal(parsed)),
    retry: false,
  });
  const deposit = useQuery({
    queryKey: ["deposit", depositId],
    queryFn: () => walletApi.deposit(depositId!),
    enabled: Boolean(depositId),
    refetchInterval: (query) => (query.state.data && depositIsFinal(query.state.data) ? false : 3_000),
  });
  const sendCode = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/paj/initiate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "We couldn't send the code.");
    },
    onSuccess: () => setStep("code"),
    onError: (cause) => setError(cause instanceof Error ? cause.message : "We couldn't send the code."),
  });
  const verify = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/paj/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), otp: code, device: { uuid: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "web", device: "Web", browser: navigator.userAgent.slice(0, 100) } }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "That code didn't work.");
      return body as PajSession;
    },
    onSuccess: (value) => { setSession(value); setStep("pay"); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "That code didn't work."),
  });
  const reserveAndOrder = useMutation({
    mutationFn: async () => {
      if (!session || !isPositiveDecimal(parsed)) throw new Error("Enter a valid amount.");
      const freshQuote = await pajApi.quote(parsed, session);
      if (!Number.isFinite(freshQuote.rate) || freshQuote.rate <= 0) throw new Error("Paj returned an invalid rate. Try again.");
      const quotedUsdc = usdcAmountAtLeastMinimum(freshQuote.amount, source.minimum);
      if (!quotedUsdc) throw new Error(`This amount is below the ${source.minimum} USDC minimum at the current Paj quote. Enter a larger amount.`);
      depositKey.current ??= typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reserved = await walletApi.createDeposit(source, source.minimum, depositKey.current);
      setOrderAttempted(true);
      const placed = await pajApi.order(parsed, reserved.address, session);
      const usdc = usdcAmountAtLeastMinimum(placed.amount, source.minimum);
      if (!usdc) throw new Error(`This amount is below the ${source.minimum} USDC minimum after Paj's fees.`);
      if (!isCompleteBankDetails(placed)) throw new Error("Paj returned incomplete bank details. No safe transfer instructions are available.");
      return { reserved, placed, usdc };
    },
    onSuccess: ({ reserved, placed }) => { setDepositId(reserved.deposit_id); setOrder(placed); setDetails(orderDetails(placed)); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "We couldn't prepare the bank transfer."),
  });
  const sent = useMutation({
    mutationFn: async () => { if (!order || !depositId || deposit.data?.state === "expired") throw new Error("These bank details have expired. Start a new deposit."); return order; },
    onSuccess: (placed) => { const usdc = decimalText(placed.amount); if (!usdc || !owner) { setError("Your wallet session is unavailable. Sign in again before recording this deposit."); return; } recordBankDeposit({ depositId: depositId!, naira: parsed, usdc, startedAt: new Date().toISOString() }, owner); setStep("receiving"); queryClient.invalidateQueries({ queryKey: keys.activity("all") }); },
  });

  useEffect(() => {
    if (deposit.data?.state === "landed") {
      queryClient.invalidateQueries({ queryKey: keys.vault });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    }
  }, [deposit.data?.state, queryClient]);

  const amountOk = isPositiveDecimal(parsed);
  const instructionsReady = Boolean(order && isCompleteBankDetails(order) && deposit.data?.state !== "expired");
  return (
    <Drawer title="Bank transfer · Nigeria" onClose={onClose} footer={step === "pay" && instructionsReady ? <button type="button" className="btn ink lg" disabled={sent.isPending} onClick={() => sent.mutate()}>{sent.isPending ? "Saving" : "I've sent the money"}</button> : step === "receiving" ? <button type="button" className="btn ink lg" onClick={onClose}>Close</button> : undefined}>
      {step === "amount" && <>
        <p className="muted">Pay in naira from any Nigerian bank. Paj converts it to USDC for your vault.</p>
        <div className="field"><label htmlFor="paj-naira">How much will you send?</label><input id="paj-naira" className="inp num" inputMode="numeric" placeholder="₦2,500" value={amount} onChange={(event) => { setAmount(event.target.value); setError(null); }} />{amount && !amountOk && <span className="err">Enter a whole, positive naira amount.</span>}</div>
        {amountOk && <div className="card" style={{ padding: 14 }}>You are paying <b>{formatNaira(parsed)}</b>. The exact USDC amount is confirmed by Paj after email verification.</div>}
        {quote.isError && <Notice tone="bad">{quote.error.message}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        <button type="button" className="btn ink" disabled={!amountOk} onClick={() => { setError(null); setStep("email"); }}>Continue</button>
      </>}
      {step === "email" && <>
        <p className="muted">Confirm your email with Paj once to get bank details.</p>
        <div className="field"><label htmlFor="paj-email">Email</label><input id="paj-email" className="inp" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        {error && <Notice tone="bad">{error}</Notice>}<button type="button" className="btn ink" disabled={!email.includes("@") || sendCode.isPending} onClick={() => { setError(null); sendCode.mutate(); }}>{sendCode.isPending ? <><Spinner /> Sending</> : "Send code"}</button>
      </>}
      {step === "code" && <>
        <p className="muted">Enter the code sent to {email}.</p><div className="field"><label htmlFor="paj-code">Code</label><input id="paj-code" className="inp num" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
        {error && <Notice tone="bad">{error}</Notice>}<button type="button" className="btn ink" disabled={code.length < 4 || verify.isPending} onClick={() => { setError(null); verify.mutate(); }}>{verify.isPending ? <><Spinner /> Checking</> : "Confirm email"}</button>
      </>}
      {step === "pay" && <>
        {reserveAndOrder.isPending && <Notice icon="spin">Preparing your bank details</Notice>}
        {!order && !reserveAndOrder.isPending && !orderAttempted && <button type="button" className="btn ink" disabled={quote.isPending} onClick={() => { setError(null); reserveAndOrder.mutate(); }}>{quote.isPending ? "Getting quote" : "Get bank details"}</button>}
        {orderAttempted && !order && reserveAndOrder.isError && <Notice tone="bad">{reserveAndOrder.error.message}</Notice>}
        {order && instructionsReady && <><div className="card" style={{ display: "grid", gap: 8 }}><b>{details.bank}</b><span>Account name: {details.accountName}</span><span className="mono">Account number: {details.accountNumber}</span><span>Pay exactly {formatNaira(parsed)} from your bank app.</span></div>{deposit.data?.state === "expired" ? <Notice tone="bad">These bank details expired. Start a new deposit before paying.</Notice> : <Notice>After payment, tap “I&apos;ve sent the money”. Your deposit will stay visible while it moves into your vault.</Notice>}</>}
        {order && !instructionsReady && <Notice tone="bad">Paj did not return complete bank details. No transfer instructions are available.</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
      </>}
      {step === "receiving" && <><Notice icon="spin">Your bank transfer is on its way. You can close this and follow it from Activity.</Notice>{deposit.data && <span className="muted">Deposit status: {deposit.data.state}.</span>}</>}
    </Drawer>
  );
}
