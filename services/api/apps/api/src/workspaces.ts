import { createHash, randomBytes } from "node:crypto";
import { newId } from "../../../packages/db/src/ids.js";
import { workspaceView } from "./dashboard.js";
import type { Db } from "./db.js";

// "rt_test_" plus four characters, enough to recognise a key without revealing it.
const KEY_PREFIX_LENGTH = 12;

interface WorkspaceInput {
  name: string;
  use_case: "wallet" | "payroll" | "marketplace" | "agent" | "other";
  countries: string[];
}

// Spec: the sandbox key starts with rt_test_ and is shown once; only its hash is stored.
export async function createWorkspace(db: Db, ownerId: string, input: WorkspaceInput) {
  const workspace = await db.workspace.create({
    data: { id: newId("ws"), ownerId, name: input.name.trim(), useCase: input.use_case, countries: [...new Set(input.countries)] },
  });
  const key = `rt_test_${randomBytes(18).toString("base64url")}`;
  const apiKey = await db.apiKey.create({
    data: {
      id: newId("key"),
      workspaceId: workspace.id,
      environment: "test",
      keyHash: createHash("sha256").update(key).digest("hex"),
      prefix: key.slice(0, KEY_PREFIX_LENGTH),
      last4: key.slice(-4),
    },
  });
  return {
    workspace: workspaceView(workspace),
    sandbox_key: { key_id: apiKey.id, key },
  };
}
