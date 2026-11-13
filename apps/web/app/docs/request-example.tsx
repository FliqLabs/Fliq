import { CodeBlock } from "./code-block";
import { playgroundFixtures } from "./playground-fixtures";
import { quickstartExamples } from "./content/quickstart-examples";

const examples = quickstartExamples(
  playgroundFixtures["POST /v1/quote"].quote_id,
  playgroundFixtures.settled.payout_id,
);

export function PlaygroundRequest({ id }: { id: "verify" | "quote" | "payout" }) {
  const example = examples.find((example) => example.id === id)!;
  return <CodeBlock text={example.curl} />;
}
