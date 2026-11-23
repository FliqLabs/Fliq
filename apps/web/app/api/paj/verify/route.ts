import { type NextRequest } from "next/server";
import { verifyPajSession } from "../../../lib/paj-session";

export async function POST(request: NextRequest) {
  return verifyPajSession(request);
}
