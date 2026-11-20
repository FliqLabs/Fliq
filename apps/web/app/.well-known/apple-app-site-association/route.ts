import { association } from "../../lib/apple-app-site-association";

export function GET() {
  return Response.json(association);
}
