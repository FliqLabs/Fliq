import { existsSync, writeFileSync } from "node:fs";
import { KeyPair } from "near-api-js";

// Makes the agent's key on the machine that runs the agent. Only the public key leaves it: the owner scans or pastes
// it when connecting the agent in the app.
const path = process.argv[2];
if (!path) {
  console.error("usage: keygen <path to write the private key>");
  process.exit(1);
}
if (existsSync(path)) {
  console.error(`${path} already exists; keeping it`);
  process.exit(1);
}
const key = KeyPair.fromRandom("ed25519");
writeFileSync(path, `${key.toString()}\n`, { mode: 0o600 });
console.log(key.getPublicKey().toString());
