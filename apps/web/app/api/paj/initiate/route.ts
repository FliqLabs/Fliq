import { type NextRequest } from "next/server";
import { initiatePajSession } from "../../../lib/paj-session";

export async function POST(request: NextRequest) {
  return initiatePajSession(request);
}
