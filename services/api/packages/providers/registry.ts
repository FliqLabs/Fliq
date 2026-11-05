import type { ProviderAdapter, ProviderId } from "./types";

export type ProviderRegistry = {
  get(id: ProviderId): ProviderAdapter;
  list(): ProviderAdapter[];
};

// The orchestrator asks for adapters by configuration, never by importing a provider (ARCH §9).
export function createProviderRegistry(adapters: readonly ProviderAdapter[]): ProviderRegistry {
  const byId = new Map<ProviderId, ProviderAdapter>();
  for (const adapter of adapters) {
    if (byId.has(adapter.id)) throw new Error(`provider ${adapter.id} registered twice`);
    byId.set(adapter.id, adapter);
  }
  return {
    get(id) {
      const adapter = byId.get(id);
      if (!adapter) throw new Error(`provider ${id} is not enabled`);
      return adapter;
    },
    list: () => [...byId.values()],
  };
}
