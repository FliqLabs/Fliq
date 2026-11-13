import { runExample } from "./playground-runtime.mjs";
import { playgroundFixtures } from "./playground-fixtures";

export function runPlayground(source: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Isolated code playground";
    frame.sandbox.add("allow-scripts");
    frame.referrerPolicy = "no-referrer";
    const workerSource = `const runExample = ${runExample.toString()};
self.onmessage = async ({ data }) => {
  try { self.postMessage({ output: await runExample(data.source, data.fixtures) }); }
  catch (error) { self.postMessage({ error: error.message || String(error) }); }
};`;
    // An opaque-origin frame keeps edited code away from account data; CSP blocks network access.
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'">
<script>
const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource).replaceAll("<", "\\u003c")}], { type: 'text/javascript' })));
worker.onmessage = ({data}) => parent.postMessage(data, '*');
worker.onerror = () => parent.postMessage({error: 'Unable to run this example.'}, '*');
onmessage = ({data}) => worker.postMessage(data);
</script>`;
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      frame.remove();
    }
    function abort() {
      cleanup();
      reject(new Error("Run cancelled."));
    }
    function receive(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || (typeof data.output !== "string" && typeof data.error !== "string")) return;
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.output.slice(0, 50_000));
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Execution stopped after 3 seconds. Check for an endless loop or a promise that never completes.",
        ),
      );
    }, 3000);
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    frame.onload = () => frame.contentWindow?.postMessage({ source, fixtures: playgroundFixtures }, "*");
    if (signal.aborted) abort();
    else document.body.append(frame);
  });
}
