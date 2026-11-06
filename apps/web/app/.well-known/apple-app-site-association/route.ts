// Lets the fliq iPhone app (team YCKKUWB4WD) create and use passkeys for fliq.cash.
const association = {
  webcredentials: { apps: ["YCKKUWB4WD.cash.fliq.app"] },
};

export function GET() {
  return Response.json(association);
}
