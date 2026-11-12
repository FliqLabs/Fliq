const base = "https://fliq-yclq.onrender.com/v1";

export function quickstartExamples(quoteId: string, payoutId: string) {
  return [
    {
      id: "rates",
      title: "Read a rate",
      description:
        "Start with the USDC → NGN corridor. Run the example to see the rate and provider response.",
      href: "/docs/rates",
      link: "Explore rates",
      curl: `curl ${base}/rates/usdc/ngn`,
      TypeScript: `const response = await fetch("${base}/rates/usdc/ngn");\nconst rate = await response.json();\nconsole.log(rate);`,
    },
    {
      id: "verify",
      title: "Verify the recipient",
      description:
        "Use the demo account to look up the recipient’s name. Try changing the account number to see an error.",
      href: "/docs/account-verification",
      link: "Explore account verification",
      curl: `curl -X POST ${base}/accounts/verify \\\n  -H "Content-Type: application/json" \\\n  -d '{"bank":"058","number":"0123456789"}'`,
      TypeScript: `const response = await fetch("${base}/accounts/verify", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ bank: "058", number: "0123456789" }),\n});\nconsole.log(await response.json());`,
    },
    {
      id: "quote",
      title: "Get a quote",
      description:
        "Preview a $50 payout. Inspect the after-fee rate, recipient amount, provider and expiration in the result.",
      href: "/docs/quotes",
      link: "Explore quotes",
      curl: `curl -X POST ${base}/quote \\\n  -H "Content-Type: application/json" \\\n  -d '{"token":"usdc","currency":"ngn","amount":"50.00"}'`,
      TypeScript: `const response = await fetch("${base}/quote", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ token: "usdc", currency: "ngn", amount: "50.00" }),\n});\nconst quote = await response.json();\nconsole.log(quote);`,
    },
    {
      id: "payout",
      title: "Preview a payout",
      description:
        "The quote ID is already filled in. Run this example to inspect a demo payout; no funds move. Each step can run independently.",
      href: "/docs/payouts",
      link: "Explore payouts",
      curl: `curl -X POST ${base}/payouts \\\n  -H "Content-Type: application/json" \\\n  -d '{"quote_id":"${quoteId}","account":{"bank":"058","number":"0123456789"}}'`,
      TypeScript: `const response = await fetch("${base}/payouts", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    quote_id: "${quoteId}",\n    account: { bank: "058", number: "0123456789" },\n  }),\n});\nconst payout = await response.json();\nconsole.log(payout);\n\n// Inspect the completed demo payout.\nconst status = await fetch("${base}/payouts/${payoutId}");\nconsole.log(await status.json());`,
    },
  ];
}
