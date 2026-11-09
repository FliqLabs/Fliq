import type { Chain } from "../../../packages/providers/types.js";

const EVM = /^0x[0-9a-fA-F]{40}$/;
const BASE58 = "[1-9A-HJ-NP-Za-km-z]";

// What an address looks like on each network a provider can be funded on. A refund sent to an address of the wrong
// shape is refused by the provider, or worse, lost.
const FORMATS: Partial<Record<Chain, RegExp>> = {
  near: /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/,
  base: EVM,
  polygon: EVM,
  ethereum: EVM,
  arbitrum: EVM,
  bnb: EVM,
  solana: new RegExp(`^${BASE58}{32,44}$`),
  tron: new RegExp(`^T${BASE58}{33}$`),
};

// True when the address has the shape the network expects. A network this table does not know is not checked.
export function isAddressOn(chain: string, address: string): boolean {
  const format = FORMATS[chain as Chain];
  return format ? format.test(address) : true;
}

// PROVIDER_REFUND_ADDRESS_<NETWORK>: where a provider refunds a payout it was funded for on that network.
// A value of the wrong shape is ignored, so a typo never reaches a provider.
export function refundAddressesFrom(env: NodeJS.ProcessEnv): Partial<Record<string, string>> {
  const addresses: Partial<Record<string, string>> = {};
  for (const [name, raw] of Object.entries(env)) {
    const match = /^PROVIDER_REFUND_ADDRESS_([A-Z]+)$/.exec(name);
    const value = raw?.trim();
    if (!match || !value) continue;
    const chain = (match[1] as string).toLowerCase();
    if (isAddressOn(chain, value)) addresses[chain] = value;
    else console.warn(`${name} is not a ${chain} address; it is ignored.`);
  }
  return addresses;
}
