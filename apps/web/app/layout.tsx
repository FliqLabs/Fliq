import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fliq — Global crypto. Local money.",
  description: "Move from stablecoins to local bank accounts and mobile money with Fliq.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="w-full flex min-h-screen flex-col bg-canvas text-white">
        <SiteHeader />
        <div className="flex-1 pt-[68px]">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
