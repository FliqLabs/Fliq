import type { NearRpc } from "./rpc";
import { publicKeyOf, signTransaction, storageDepositActions, type SigningKey } from "./transactions";

export type TokenStorageOptions = {
  rpc: NearRpc;
  tokenContractId: string;
  // Needs a full-access key: a function-call key can neither call the token nor attach the deposit.
  payer: SigningKey;
};

export class TokenStorageError extends Error {
  constructor(detail: string) {
    super(`storage_deposit failed: ${detail.slice(0, 300)}`);
    this.name = "TokenStorageError";
  }
}

// The vault's ft_transfer to an address that is not registered on the token fails, so a payout address is
// registered before its order opens. The payer spends the token's minimum storage deposit per new address.
export class TokenStorage {
  readonly #options: TokenStorageOptions;
  readonly #publicKey: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: TokenStorageOptions) {
    this.#options = options;
    this.#publicKey = publicKeyOf(options.payer.privateKey);
  }

  async ensure(accountId: string): Promise<{ txHash: string } | null> {
    const { rpc, tokenContractId } = this.#options;
    if ((await rpc.callView(tokenContractId, "storage_balance_of", { account_id: accountId })) !== null) return null;
    const bounds = (await rpc.callView(tokenContractId, "storage_balance_bounds", {})) as { min?: unknown } | null;
    if (typeof bounds?.min !== "string" || !/^\d+$/.test(bounds.min))
      throw new TokenStorageError(`${tokenContractId} returned no storage minimum`);
    return this.#send(accountId, BigInt(bounds.min));
  }

  // One payer key signs every deposit, so they are sent one after another and each takes the next nonce.
  #send(accountId: string, depositYocto: bigint): Promise<{ txHash: string }> {
    const run = async () => {
      const { rpc, tokenContractId, payer } = this.#options;
      const [key, block] = await Promise.all([rpc.accessKey(payer.accountId, this.#publicKey), rpc.finalBlock()]);
      if (!key) throw new TokenStorageError("the payer key is not on the payer account");
      const tx = await signTransaction({
        signer: payer,
        receiverId: tokenContractId,
        nonce: key.nonce + 1n,
        blockHash: block.hash,
        actions: storageDepositActions(accountId, depositYocto),
      });
      const outcome = await rpc.sendTransaction(tx.base64);
      if (outcome.status === "failed") throw new TokenStorageError(outcome.failures.join(" "));
      return { txHash: tx.txHash };
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }
}
