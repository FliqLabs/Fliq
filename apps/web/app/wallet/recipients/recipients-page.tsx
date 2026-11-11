"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../components/app/icons";
import { Avatar, Chip, ConfirmModal, Notice, Spinner, useToast } from "../../components/app/ui";
import { bankLogo } from "../../lib/assets";
import { forgetNumber } from "../../lib/saved-accounts";
import { walletApi, type Recipient } from "../../lib/wallet-api";
import { keys, useRecentPeople, useRecipients } from "../../lib/wallet-queries";
import { when } from "../activity-ui";
import { AddRecipientDrawer } from "../recipient-drawer";

export function RecipientsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const recipients = useRecipients();
  const people = useRecentPeople();
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [removing, setRemoving] = useState<Recipient | null>(null);

  const remove = useMutation({
    mutationFn: (recipient: Recipient) => walletApi.deleteRecipient(recipient.recipient_id),
    onSuccess: (_, recipient) => {
      forgetNumber(recipient.recipient_id);
      queryClient.invalidateQueries({ queryKey: keys.recipients });
      setRemoving(null);
      toast("Recipient removed");
    },
  });

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Recipients</h1>
          <p>Every account is checked with the bank before it is saved, so the name you see is the name on the account.</p>
        </div>
        <div className="acts">
          <button type="button" className="btn ink" onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} />
            Add recipient
          </button>
        </div>
      </div>
      {recipients.isPending && (
        <div className="empty">
          <Spinner />
        </div>
      )}
      {recipients.isError && <Notice tone="bad">{recipients.error.message}</Notice>}
      <div className="pgrid">
        {recipients.data?.items.map((recipient) => (
          <section key={recipient.recipient_id} className="card pcard">
            <div className="top">
              <Avatar name={recipient.account_name} badge={bankLogo(recipient.bank.logo_key, recipient.bank.code, recipient.bank.name)} />
              <div className="t">
                <b>
                  {recipient.account_name}
                  {recipient.own && (
                    <span className="chip" style={{ marginLeft: 6 }}>
                      You
                    </span>
                  )}
                </b>
                <span>
                  {recipient.bank.name} ••{recipient.account_last4}
                </span>
              </div>
            </div>
            <dl className="kv" style={{ margin: "0 -18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ padding: "10px 18px" }}>
                <dt>Name at bank</dt>
                <dd>{recipient.account_name}</dd>
              </div>
              <div style={{ padding: "10px 18px" }}>
                <dt>Saved</dt>
                <dd>{when(recipient.created_at)}</dd>
              </div>
            </dl>
            <div className="acts">
              <Link className="btn ink sm" href={`/wallet/send?to=${encodeURIComponent(recipient.recipient_id)}`}>
                <Icon name="send" size={15} />
                Send
              </Link>
              <button type="button" className="btn line sm" onClick={() => setRemoving(recipient)}>
                Remove
              </button>
            </div>
          </section>
        ))}
        {people.data?.items.map((person) => (
          <section key={person.near_account} className="card pcard">
            <div className="top">
              <Avatar name={person.display_name ?? person.near_account} photo={person.photo_url} badge="/landing/tokens/near.webp" />
              <div className="t">
                <b>{person.display_name ?? person.near_account}</b>
                <span>{person.near_account} · fliq account</span>
              </div>
            </div>
            <dl className="kv" style={{ margin: "0 -18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ padding: "10px 18px" }}>
                <dt>Account</dt>
                <dd>{person.near_account}</dd>
              </div>
              <div style={{ padding: "10px 18px" }}>
                <dt>Last paid</dt>
                <dd>{person.last_paid_at ? when(person.last_paid_at) : "Never"}</dd>
              </div>
            </dl>
            <div className="acts">
              <Link className="btn ink sm" href={`/wallet/send?person=${encodeURIComponent(person.near_account)}`}>
                <Icon name="send" size={15} />
                Send
              </Link>
              <Chip tone="good">Free and instant</Chip>
            </div>
          </section>
        ))}
      </div>
      {recipients.isSuccess && recipients.data.items.length === 0 && !people.data?.items.length && (
        <section className="card pad">
          <p className="muted" style={{ margin: 0 }}>
            No recipients yet. Add a bank or mobile money account and it is ready for your next send.
          </p>
        </section>
      )}
      {adding && (
        <AddRecipientDrawer
          onClose={() => {
            setAdding(false);
            if (params.get("add")) router.replace("/wallet/recipients");
          }}
          onSaved={({ recipient }) => {
            setAdding(false);
            toast(`${recipient.account_name} saved`);
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Remove this recipient?"
          text={`${removing.account_name} leaves your saved list. You can add them again any time, and past receipts stay in Activity.`}
          cta="Remove"
          danger
          busy={remove.isPending}
          error={remove.error?.message}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
