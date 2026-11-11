// Lets the fliq iPhone apps (team YCKKUWB4WD) create and use passkeys for fliq.cash: the testnet app and "fliq main",
// the mainnet build installed beside it.
const association = {
  webcredentials: { apps: ["YCKKUWB4WD.cash.fliq.app", "YCKKUWB4WD.cash.fliq.app.mainnet"] },
};

export function GET() {
  return Response.json(association);
}
