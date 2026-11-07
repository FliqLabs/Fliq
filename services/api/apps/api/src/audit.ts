import type { Prisma } from "@prisma/client";
import { newId } from "../../../packages/db/src/ids.js";
import type { Db } from "./db.js";

export interface AuditActor {
  userId: string;
  workspaceId: string;
  traceId?: string;
}

export interface AuditRecord {
  action: string;
  targetType: string;
  targetId: string;
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
}

// Written in the caller's transaction, so the action and its audit row commit or roll back together.
export async function audit(tx: Db, actor: AuditActor, record: AuditRecord): Promise<void> {
  await tx.auditEvent.create({
    data: {
      id: newId("aud"),
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      ...(record.before ? { before: record.before } : {}),
      ...(record.after ? { after: record.after } : {}),
      traceId: actor.traceId ?? null,
    },
  });
}
