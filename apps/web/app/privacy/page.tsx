import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { siteContainer } from "../components/site-container";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"], weight: "700" });

export const metadata: Metadata = {
  title: "Privacy Policy | fliq",
  description: "What fliq collects, why, who it is shared with, and how to have it deleted.",
};

const UPDATED = "14 November 2026";
const CONTACT_URL = "https://github.com/FliqLabs/Fliq/issues";

type Section = { title: string; paragraphs?: string[]; items?: string[] };

const sections: Section[] = [
  {
    title: "What fliq is",
    paragraphs: [
      "fliq is an iPhone app and a website (fliq.cash) that lets you hold US dollar stablecoins in a vault on the NEAR blockchain, pay other fliq users, and cash out to a bank or mobile money account. This policy covers both the app and the website.",
    ],
  },
  {
    title: "What we collect",
    items: [
      "Account details: your fliq name, your display name, and your email address if you sign in with email. If you sign in with a passkey we store the passkey's public part only. We never receive your Face ID or fingerprint data; that stays on your device.",
      "Your profile photo, if you add one.",
      "Payment details: the bank or mobile money accounts you save or pay (bank, account number and the account holder's name), and a record of your deposits, payments, cash-outs and requests.",
      "Your NEAR account name and the public key your device creates. The private key is made on your device and never leaves it.",
      "Device details: a push notification token if you turn notifications on, and basic technical logs such as IP address, app version and the time of each request.",
    ],
  },
  {
    title: "What we do not collect",
    items: [
      "We do not use advertising trackers and we do not sell your data.",
      "We do not read your contacts, your location or your photo library. The camera is used only when you scan a payment code or take a profile photo.",
      "We do not hold your money. Your balance sits in a contract on NEAR that only your account can spend from.",
    ],
  },
  {
    title: "Why we use it",
    items: [
      "To create your account and let you sign in.",
      "To carry out the payments, deposits and cash-outs you ask for, and to show you receipts and history.",
      "To check an account holder's name with the bank before you pay.",
      "To send notifications about your money.",
      "To prevent fraud and abuse, fix faults, and meet legal duties.",
    ],
  },
  {
    title: "Who we share it with",
    paragraphs: ["Only the companies needed to run the service, and only what each one needs:"],
    items: [
      "Payout providers, such as Paycrest, receive the recipient's bank details and the amount so the bank can be paid.",
      "The bank transfer deposit provider, Paj, handles Naira deposits. Paj may ask you to verify yourself with it directly, under its own privacy policy.",
      "NEAR Intents routes deposits from other networks and receives the deposit addresses and amounts.",
      "Our hosting and delivery services: Railway and Vercel for hosting, Cloudinary for profile photos, Apple for push notifications, and an email service for sign-in links.",
      "Authorities, when the law requires it.",
    ],
  },
  {
    title: "What is public on the blockchain",
    paragraphs: [
      "Transactions on NEAR are public and permanent. Your NEAR account name, which includes your fliq name, and the amounts and times of on-chain transfers can be seen by anyone and cannot be deleted by us or by anyone else. Bank account numbers and recipient names are never written to the blockchain.",
    ],
  },
  {
    title: "How long we keep it",
    paragraphs: [
      "We keep your account details for as long as you have an account. Records of payments are kept for as long as financial and anti-fraud rules require, even after an account is closed. Technical logs are kept for a short period.",
    ],
  },
  {
    title: "Your choices",
    items: [
      "You can change your display name and photo, and remove saved accounts, in the app.",
      "You can turn notifications off in the app or in iOS Settings.",
      "You can ask for a copy of your data, a correction, or the deletion of your account. We will delete what we are not required to keep. On-chain records cannot be deleted.",
      "You can withdraw your dollars from the vault at any time without our help.",
    ],
  },
  {
    title: "Security",
    paragraphs: [
      "Data is encrypted in transit, and sensitive fields are encrypted where they are stored. Money can only leave your vault after you approve it on your device. No system is perfectly secure, so please use small amounts while fliq is in beta.",
    ],
  },
  {
    title: "Children",
    paragraphs: ["fliq is not for anyone under 18, and we do not knowingly collect data from children."],
  },
  {
    title: "Changes",
    paragraphs: ["If this policy changes we will update this page and the date at the top. For a significant change we will tell you in the app."],
  },
];

export default function PrivacyPage() {
  return (
    <div className={`${inter.className} min-h-screen bg-[#161616] text-white`}>
      <SiteHeader activeHref="/privacy" brandClassName={outfit.className} />
      <main className={`${siteContainer} pt-[120px] pb-[72px] sm:pt-[125px]`}>
        <article className="mx-auto max-w-[720px]">
          <h1 className="text-[clamp(34px,4vw,52px)] leading-[1.2] font-bold tracking-[-0.035em]">Privacy Policy</h1>
          <p className="mt-4 text-sm text-[#a3a3a3]">Last updated {UPDATED}</p>
          {sections.map(({ title, paragraphs, items }) => (
            <section key={title} className="mt-10">
              <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
              {paragraphs?.map((text) => (
                <p key={text} className="mt-3 text-[16px] leading-[26px] text-[#c9c9c9]">
                  {text}
                </p>
              ))}
              {items && (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-[16px] leading-[26px] text-[#c9c9c9]">
                  {items.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-[-0.01em]">Contact</h2>
            <p className="mt-3 text-[16px] leading-[26px] text-[#c9c9c9]">
              For any privacy question or request, including deleting your account, reach the fliq team at{" "}
              <a href={CONTACT_URL} className="text-white underline underline-offset-4">
                github.com/FliqLabs/Fliq/issues
              </a>
              . Do not post personal details in a public issue: say you have a privacy request and we will give you a private way to send them.
            </p>
          </section>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
