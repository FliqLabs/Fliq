import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createOneClickMock } from "./mock";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4100);
  const mock = createOneClickMock({ now: () => new Date() });
  createServer((req, res) => void mock.handle(req, res)).listen(port, () => {
    console.log(`mock 1Click API on http://localhost:${port}`);
  });
}
