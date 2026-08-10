import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "Royze Party Needs Rental",
    template: "%s · Royze Party Needs Rental",
  },
  description:
    "Rental, supplies, and backdrop package management for Royze Party Needs Rental.",
};

export const viewport: Viewport = {
  themeColor: "#EA580C",
  // Staff work on phones outdoors; let them pinch-zoom the details.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
