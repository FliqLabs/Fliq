import { initiatePajSession } from "../../../lib/paj-session";

export async function POST(request: Request) {
  return initiatePajSession(request);
}
