import type { Country, PayoutType, ProviderId } from "../types";

// One fliq code per institution, and that institution's code at each provider that lists it.
// Provider codes come from their live lists (Paycrest /v2/institutions, Busha /v1/banks) on 2026-11-07.
// Providers without a code here (Fonbnk, TransFi) are matched by name against their own list.
export type InstitutionEntry = {
  code: string;
  country: Country;
  name: string;
  type: PayoutType;
  logoKey: string;
  names?: readonly string[];
  aliases?: readonly string[];
  providers: Partial<Record<ProviderId, string>>;
};

type Row = [
  code: string,
  name: string,
  logoKey: string,
  paycrest: string | null,
  busha: string | null,
  names?: string[],
];

function bank(country: Country, type: PayoutType) {
  return ([code, name, logoKey, paycrest, busha, names]: Row): InstitutionEntry => ({
    code,
    country,
    name,
    type,
    logoKey,
    ...(names ? { names } : {}),
    // Nigerian clients may send the NIP code Busha uses; it names the same bank.
    ...(country === "NG" && busha && busha !== code ? { aliases: [busha] } : {}),
    providers: { ...(paycrest ? { paycrest } : {}), ...(busha ? { busha } : {}) },
  });
}

// The first three keep the codes in spec/fixtures; the rest use the NIP institution code. OPay is a bank here:
// its accounts are NUBAN numbers and every provider pays them as a bank, while no provider has an NG mobile-money route.
const NG_BANKS: Row[] = [
  ["058", "GTBank", "gtbank", "GTBINGLA", "000013", ["Guaranty Trust Bank", "GT Bank"]],
  ["044", "Access Bank", "access-bank", "ABNGNGLA", "000014"],
  ["999992", "OPay", "opay", "OPAYNGPC", "100004"],
  ["000015", "Zenith Bank", "zenith-bank", "ZEIBNGLA", "000015"],
  [
    "000016",
    "First Bank",
    "first-bank",
    "FBNINGLA",
    "000016",
    ["First Bank of Nigeria", "Firstbank of Nigeria"],
  ],
  ["000004", "UBA", "uba", "UNAFNGLA", "000004", ["United Bank for Africa"]],
  [
    "090405",
    "Moniepoint",
    "moniepoint",
    "MONINGPC",
    "090405",
    ["Moniepoint MFB", "Moniepoint Microfinance Bank"],
  ],
  ["100033", "PalmPay", "palmpay", "PALMNGPC", "100033"],
  ["090267", "Kuda", "kuda", "KUDANGPC", "090267", ["Kuda Microfinance Bank", "Kuda Bank"]],
  ["000003", "FCMB", "fcmb", "FCMBNGLA", "000003", ["First City Monument Bank"]],
  ["000007", "Fidelity Bank", "fidelity-bank", "FIDTNGLA", "000007"],
  ["000001", "Sterling Bank", "sterling-bank", "NAMENGLA", "000001"],
  ["000017", "Wema Bank", "wema-bank", "WEMANGLA", "000017"],
  ["000018", "Union Bank", "union-bank", "UBNINGLA", "000018"],
  ["000012", "Stanbic IBTC", "stanbic-ibtc", "SBICNGLX", "000012", ["Stanbic IBTC Bank"]],
  ["000010", "Ecobank", "ecobank", "ECOCNGLA", "000010", ["Ecobank Nigeria", "Ecobank Bank"]],
  ["000008", "Polaris Bank", "polaris-bank", "PRDTNGLA", "000008"],
  ["000002", "Keystone Bank", "keystone-bank", "PLNINGLA", "000002"],
  ["000023", "Providus Bank", "providus-bank", "UMPLNGLA", "000023"],
  ["000020", "Heritage Bank", "heritage-bank", "HBCLNGLA", "000020", ["Heritage"]],
  ["000011", "Unity Bank", "unity-bank", "ICITNGLA", "000011"],
  ["000006", "Jaiz Bank", "jaiz-bank", "JAIZNGLA", "000006"],
  ["000021", "Standard Chartered", "standard-chartered", "SCBLNGLA", "000021", ["Standard Chartered Bank"]],
  ["000009", "Citibank", "citibank", "CITINGLA", "000009", ["Citibank Nigeria"]],
  ["000027", "Globus Bank", "globus-bank", "GLOUNGLA", "000027"],
  ["000025", "Titan Trust Bank", "titan-trust-bank", "TTRUNGLA", "000025"],
  ["000022", "SunTrust Bank", "suntrust-bank", "SUTGNGLA", "000022"],
  ["000026", "TAJ Bank", "taj-bank", "TAJJNGLA", "000026"],
  ["000031", "PremiumTrust Bank", "premiumtrust-bank", "PTRUNGLA", "000031", ["Premium Trust Bank"]],
  ["000036", "Optimus Bank", "optimus-bank", "OPTSNGLA", "000036"],
  ["000024", "Rand Merchant Bank", "rand-merchant-bank", "FIRNNGLA", "000024"],
  ["060001", "Coronation Merchant Bank", "coronation-bank", "CMBBNGLA", "060001", ["Coronation Bank"]],
  ["400001", "FSDH Merchant Bank", "fsdh", "FSDHNGLA", "400001", ["FSDH"]],
  ["060002", "FBNQuest Merchant Bank", "fbnquest", "KDHLNGLA", "060002", ["FBNQuest Bank"]],
  ["060003", "Nova Bank", "nova-bank", "NVMBNGLA", "060003", ["Nova Merchant Bank"]],
  ["100002", "Paga", "paga", "PAGANGPC", "100002"],
  ["100026", "Carbon", "carbon", "CARBNGPC", "100026", ["Carbon Microfinance Bank (One Finance)"]],
  ["090110", "VFD Microfinance Bank", "vfd", "VFDXNGPC", "090110"],
  [
    "090551",
    "FairMoney",
    "fairmoney",
    "FAIRNGPC",
    "090551",
    ["Fairmoney Microfinance Bank", "Fairmoney MFB"],
  ],
  ["090325", "Sparkle", "sparkle", "SPARNGPC", "090325", ["Sparkle Microfinance Bank"]],
  [
    "100039",
    "Paystack-Titan",
    "paystack-titan",
    "PAYTNGPC",
    "100039",
    ["Paystack-Titan MFB", "Titan-Paystack"],
  ],
  ["120001", "9PSB", "9psb", "IPSBNGLA", "120001", ["9 Payment Service Bank", "9 Payment Solutions Bank"]],
  ["120003", "MoMo PSB", "momo-psb", "MOMONGPC", "120003", ["MoMo Payment Service Bank"]],
  ["120004", "SmartCash PSB", "smartcash-psb", "SMARNGPC", "120004", ["Smartcash Payment Service Bank"]],
  ["100022", "GoMoney", "gomoney", "GOMONGPC", "100022", ["Sterling Mobile (Gomoney)"]],
  ["090328", "Eyowo", "eyowo", "EYOWNGPC", "090328", ["Eyowo MFB", "Eyowo Microfinance Bank"]],
  ["090177", "LAPO Microfinance Bank", "lapo", "LAPONGPC", "090177"],
  ["090004", "Parallex Bank", "parallex-bank", "PARANGLA", "090004", ["Prallex Bank"]],
];

// Kenyan banks use the two-digit bank code Busha lists.
const KE_BANKS: Row[] = [
  ["68", "Equity Bank", "equity-bank", "EQBLKENA", "68", ["Equity Bank Limited"]],
  ["01", "KCB", "kcb", "KCBLKENX", "01", ["Kenya Commercial Bank", "Kenya Commercial Bank Limited"]],
  [
    "11",
    "Co-operative Bank",
    "co-op-bank",
    "KCOOKENA",
    "11",
    ["Cooperative Bank of Kenya", "Co-Operative Bank Of Kenya Limited"],
  ],
  ["07", "NCBA", "ncba", "CBAFKENX", "07", ["NCBA Bank Kenya Plc", "National Commercial Bank of Africa"]],
  ["03", "Absa Bank Kenya", "absa-kenya", "BARCKENX", "03", ["ABSA Bank Kenya", "Absa Bank Kenya Plc"]],
  ["31", "Stanbic Bank Kenya", "stanbic-kenya", "SBICKENX", "31", ["Cfc Stanbic Bank Kenya Limited"]],
  [
    "02",
    "Standard Chartered Kenya",
    "standard-chartered-kenya",
    "SCBLKENX",
    "02",
    ["Standard Chartered Bank Limited"],
  ],
  ["63", "Diamond Trust Bank", "dtb", "DTKEKENA", "63", ["Diamond Trust Bank Limited"]],
  [
    "57",
    "I&M Bank",
    "im-bank",
    "IMBLKENA",
    "57",
    ["Investments & Morgage Limited", "Investments N Mortgages Bank Limited"],
  ],
  ["70", "Family Bank", "family-bank", "FABLKENA", "70", ["Family Bank Ltd"]],
  [
    "12",
    "National Bank of Kenya",
    "national-bank-kenya",
    "NBKEKENX",
    "12",
    ["National Bank Of Kenya Limited"],
  ],
  ["16", "Citibank Kenya", "citibank-kenya", "CITIKENA", "16", ["Citi Bank", "Citibank N.a."]],
  ["43", "Ecobank Kenya", "ecobank-kenya", "ECOCKENA", "43", ["Ecobank Plc", "Ecobank Transnational Inc."]],
  ["10", "Prime Bank", "prime-bank", "PRIEKENX", "10", ["Prime Bank Limited"]],
  [
    "53",
    "GTBank Kenya",
    "gtbank-kenya",
    "GTBIKENA",
    "53",
    ["Guaranty Trust Bank", "Guaranty Trust Holding Company PLC"],
  ],
  ["76", "UBA Kenya", "uba-kenya", "UNAFKENA", "76", ["United Bank for Africa", "Uba Kenya Bank Ltd"]],
  ["66", "Sidian Bank", "sidian-bank", "SIDNKENA", "66"],
  ["61", "HFC", "hfc", "HFCOKENA", "61", ["Housing finance Company", "Housing Finance Bank"]],
  ["74", "First Community Bank", "first-community-bank", "FCBAKEPC", "74"],
  ["72", "Gulf African Bank", "gulf-african-bank", "GAFRKENA", "72", ["Gulf African Bank Ltd"]],
  [
    "19",
    "Bank of Africa Kenya",
    "bank-of-africa-kenya",
    "AFRIKENX",
    "19",
    ["Bank of Africa", "Bank Of  Africa Kenya Limited"],
  ],
  [
    "35",
    "African Banking Corporation",
    "abc-bank",
    "ABCLKENA",
    "35",
    ["African Bank Corporation Limited", "African Banking Corp. Bank Ltd"],
  ],
  [
    "51",
    "Kingdom Bank",
    "kingdom-bank",
    "CIFIKENA",
    "51",
    ["Kingdom Bank Limited", "Kingdom Bank(Jamii Bora Bank)"],
  ],
  [
    "23",
    "Consolidated Bank",
    "consolidated-bank",
    "CONKKENA",
    "23",
    ["Consolidated Bank Kenya", "Consolidated Bank Of Kenya Limited"],
  ],
  ["25", "Credit Bank", "credit-bank", "CRBTKENA", "25", ["Credit Bank Limited"]],
  [
    "46",
    "Choice Microfinance Bank",
    "choice-bank",
    "CHFIKENX",
    "46",
    ["Choice Microfinance Bank Kenya Limited"],
  ],
  ["50", "Paramount Bank", "paramount-bank", "PAUTKENA", "50", ["Paramount Universal Bank Limited"]],
  ["54", "Victoria Commercial Bank", "victoria-bank", "VICMKENA", "54", ["Victoria Commercial Bank Limited"]],
  ["55", "Guardian Bank", "guardian-bank", "GUARKENA", "55", ["Guardian Bank Limited"]],
  ["18", "Middle East Bank", "middle-east-bank", "MIEKKENA", "18", ["Middle East Bank Kenya Limited"]],
  [
    "14",
    "Oriental Commercial Bank",
    "oriental-bank",
    "MORBKENA",
    "14",
    ["Oriental Commercial Bank Limited", "M-Oriental Commercial Bank"],
  ],
];

const MOBILE_MONEY: InstitutionEntry[] = [
  {
    code: "mpesa",
    country: "KE",
    name: "M-Pesa",
    type: "mobile_money",
    logoKey: "mpesa",
    names: ["M-PESA", "Safaricom"],
    providers: { paycrest: "SAFAKEPC", busha: "MPESA", fonbnk: "ke_safaricom" },
  },
  {
    code: "airtel-ke",
    country: "KE",
    name: "Airtel Money",
    type: "mobile_money",
    logoKey: "airtel-money",
    names: ["AIRTEL"],
    providers: { paycrest: "AIRTKEPC" },
  },
  {
    code: "mtn",
    country: "GH",
    name: "MTN MoMo",
    type: "mobile_money",
    logoKey: "mtn-momo",
    names: ["MTN Mobile Money"],
    providers: { bitnob: "mtn", paycrest: "MOMOGHPC" },
  },
  {
    code: "telecel",
    country: "GH",
    name: "Telecel Cash",
    type: "mobile_money",
    logoKey: "telecel-cash",
    names: ["Vodafone Cash"],
    aliases: ["vodafone"],
    providers: { bitnob: "vodafone", paycrest: "VODAGHPC" },
  },
  {
    code: "airteltigo",
    country: "GH",
    name: "AirtelTigo Money",
    type: "mobile_money",
    logoKey: "airteltigo-money",
    aliases: ["airtel"],
    providers: { bitnob: "airtel", paycrest: "AIRTGHPC" },
  },
];

export const INSTITUTION_TABLE: readonly InstitutionEntry[] = [
  ...NG_BANKS.map(bank("NG", "bank")),
  ...KE_BANKS.map(bank("KE", "bank")),
  ...MOBILE_MONEY,
];
