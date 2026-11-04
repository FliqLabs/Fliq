import { MockProvisioner } from "./accounts.js";
import { buildApp } from "./app.js";
import { createEmailSender } from "./auth/email-links.js";
import { loadConfig } from "./config.js";
import { createDatabase, unitOf } from "./db.js";
import { createHandlers } from "./handlers.js";
import { createLimiter } from "./rate-limit.js";

const config = loadConfig();
const unit = unitOf(createDatabase());
const handlers = createHandlers({
  config,
  unit,
  email: createEmailSender(config),
  provisioner: new MockProvisioner(config.vaultAccount),
});

const app = buildApp({ config, unit, handlers, logger: true, limiter: createLimiter(process.env.REDIS_URL) });
await app.listen({ port: config.port, host: "0.0.0.0" });
