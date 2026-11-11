/* How a payout's state history reads as steps on the tracker. Self-contained so the node tests can import it. */

type State = string;
type Payout = {
  state: State;
  amount: string;
  provider: string;
  account_name: string;
  deposit: { chain: string };
  history: { state: State; at: string }[];
  refund?: { amount: string; to: string } | null;
};

export type StepState = "done" | "now" | "wait" | "bad";
export type Step = { key: string; title: string; detail: string; state: StepState; at: string | null };
export type Outcome = "moving" | "paid" | "refunded" | "failed";

const ORDER = ["created", "awaiting_deposit", "deposit_seen", "routing", "with_provider", "paying_out", "settled"];
const RETURNING = new Set(["refunding", "refunded"]);
const FAILED = new Set(["failed", "expired", "refused", "not_received"]);
const CHECKING = new Set(["provider_timeout", "awaiting_recon"]);

export function outcomeOf(state: State): Outcome {
  if (state === "settled") return "paid";
  if (state === "refunded") return "refunded";
  if (FAILED.has(state)) return "failed";
  return "moving";
}

export function isFinal(state: State) {
  return outcomeOf(state) !== "moving";
}

function firstAt(history: Payout["history"], states: string[]) {
  return history.find((change) => states.includes(change.state))?.at ?? null;
}

/** The furthest point on the happy path the payout reached, even if it later went wrong. */
function reached(payout: Payout) {
  const states = [payout.state, ...payout.history.map((change) => change.state)];
  return Math.max(...states.map((state) => ORDER.indexOf(state)));
}

export function progress(payout: Payout, names: { provider: string; bank: string }): Step[] {
  const crossing = payout.deposit.chain !== "near";
  const happy: Omit<Step, "state">[] = [
    { key: "approved", title: "Approved", detail: "Your vault accepted the payout", at: firstAt(payout.history, ["created"]) },
    {
      key: "vault",
      title: `Vault released $${payout.amount}`,
      detail: crossing ? `Moving to ${payout.deposit.chain} through NEAR Intents` : "Paid out once, on NEAR",
      at: firstAt(payout.history, ["awaiting_deposit"]),
    },
    {
      key: "provider",
      title: `${names.provider} received the dollars`,
      detail: "Exact amount, any excess goes back to your vault",
      at: firstAt(payout.history, ["deposit_seen", "routing"]),
    },
    {
      key: "bank",
      title: `${names.provider} is paying ${names.bank}`,
      detail: "Licensed local payout",
      at: firstAt(payout.history, ["with_provider", "paying_out"]),
    },
    { key: "paid", title: "Paid", detail: "Confirmed by the bank", at: firstAt(payout.history, ["settled"]) },
  ];
  const stageOf = (index: number) => [0, 1, 2, 3, 3, 3, 4][index];
  const current = stageOf(Math.max(0, reached(payout)));
  const outcome = outcomeOf(payout.state);

  const steps: Step[] = happy.map((step, index) => ({
    ...step,
    state: outcome === "paid" || index < current ? "done" : index === current ? "now" : "wait",
  }));
  if (outcome === "paid") return steps;

  const trouble = CHECKING.has(payout.state) || RETURNING.has(payout.state) || outcome === "failed";
  if (!trouble) return steps;

  const kept = steps.slice(0, current);
  if (CHECKING.has(payout.state)) {
    return [...kept, { key: "checking", title: `Checking with ${names.provider}`, detail: "No answer yet. Your money is safe while we confirm.", state: "now", at: firstAt(payout.history, [payout.state]) }];
  }
  if (RETURNING.has(payout.state)) {
    const done = payout.state === "refunded";
    return [
      ...kept,
      {
        key: "refund",
        title: done ? `$${payout.refund?.amount ?? payout.amount} is back in your vault` : "Sending your money back",
        detail: `${names.provider} could not pay ${payout.account_name}`,
        state: done ? "done" : "now",
        at: firstAt(payout.history, [payout.state]),
      },
    ];
  }
  return [...kept, { key: "failed", title: "This payout stopped", detail: "Nothing left your vault that has not come back", state: "bad", at: firstAt(payout.history, [payout.state]) }];
}
