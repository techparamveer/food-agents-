import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Poppins } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Comeda: food planning for hackathons",
  description:
    "Comeda plans every meal of your hackathon: restaurants, quantities by dietary need, order deadlines and a budget that holds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${poppins.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
