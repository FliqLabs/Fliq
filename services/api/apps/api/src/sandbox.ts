import { createMockProvider } from "../../../packages/providers/mock/mock.js";
import type { Chain, ProviderAdapter } from "../../../packages/providers/types.js";

const SANDBOX_CHAINS: Chain[] = ["simulated", "near", "base", "polygon", "solana"];

// The mock only declares the simulated chain. Sandbox and local runs let it accept the real ones too,
// so a quote from Base or the vault's NEAR works with no provider keys. Never used in production.
export function sandboxAdapters(now: () => Date = () => new Date()): ProviderAdapter[] {
  const { adapter } = createMockProvider({
    deps: { alert: () => undefined, now },
    webhookSecret: process.env.MOCK_WEBHOOK_SECRET ?? "sandbox",
  });
  const capabilities = adapter.capabilities();
  return [
    {
      ...adapter,
      capabilities: () => ({
        ...capabilities,
        sources: capabilities.sources.flatMap(({ asset }) => SANDBOX_CHAINS.map((chain) => ({ asset, chain }))),
      }),
    },
  ];
}
