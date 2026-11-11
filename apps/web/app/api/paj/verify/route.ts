import { verifyPajSession } from "../../../lib/paj-session";

export async function POST(request: Request) {
  return verifyPajSession(request);
}
