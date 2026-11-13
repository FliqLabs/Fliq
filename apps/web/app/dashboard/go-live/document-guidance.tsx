const checks = [
  "The business exists and is active at CAC.",
  "The director who signs is who they say they are.",
  "Payout volume matches what the business does.",
  "Nobody on the directors list is on a sanctions list.",
];

export function DocumentGuidance() {
  return (
    <aside className="space-y-6 kyb-card min-w-0 p-4 sm:p-6">
      <section>
        <h2 className="text-sm font-bold">What we check</h2>
        <ol className="mt-5 space-y-4 text-[13px] leading-5">
          {checks.map((check, index) => (
            <li key={check} className="flex gap-3">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-app-panel2 text-xs font-semibold">
                {index + 1}
              </span>
              <span>{check}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-xs leading-5 text-app-muted">
          Files are encrypted at rest and shared only with the licensed providers you go live with. Deleted 90
          days after a decision.
        </p>
        <p className="mt-2 text-xs leading-5 text-app-warn">
          Live-review policy preview. In this sandbox, selected files stay in your browser session and are not
          sent to a provider.
        </p>
      </section>
      <section className="border-t border-app-line pt-5">
        <h2 className="text-sm font-bold">Tips for a fast review</h2>
        <ul className="mt-4 space-y-3 text-[13px] leading-5 text-app-muted">
          <li>Photos are fine if every corner is visible and the text is readable.</li>
          <li>Use the legal name exactly as on the certificate.</li>
          <li>Under $50k a month usually clears in a day.</li>
        </ul>
      </section>
    </aside>
  );
}
