// Lets the fliq iPhone apps (team YCKKUWB4WD) create and use passkeys for fliq.cash: the testnet app and "fliq main",
// the mainnet build installed beside it.
// applinks: a payment request link (https://fliq.cash/pay/{name}/{code}) opens "fliq main" straight on paying it.
// Only the mainnet app takes links, so a testnet build left on a phone never catches a real request. Without the app,
// the link opens this site as before.
export const association = {
  webcredentials: { apps: ["YCKKUWB4WD.cash.fliq.app", "YCKKUWB4WD.cash.fliq.app.mainnet"] },
  applinks: {
    details: [
      {
        appIDs: ["YCKKUWB4WD.cash.fliq.app.mainnet"],
        components: [{ "/": "/pay/*/*", comment: "Payment request links" }],
      },
    ],
  },
};
