import { Prisma, PrismaClient } from "@prisma/client";

export type Db = Prisma.TransactionClient;
export type Database = PrismaClient;

// Every query runs inside one of these. Handlers never receive the raw client, so nothing can query outside a transaction.
export type Unit = <T>(work: (tx: Db) => Promise<T>) => Promise<T>;

export function createDatabase(): Database {
  return new PrismaClient({
    transactionOptions: {
      maxWait: Number(process.env.DB_TX_MAX_WAIT_MS ?? 30_000),
      timeout: Number(process.env.DB_TX_TIMEOUT_MS ?? 60_000),
    },
  });
}

export const unitOf =
  (database: Database): Unit =>
  (work) =>
    database.$transaction(work);
