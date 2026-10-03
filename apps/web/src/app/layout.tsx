import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute URLs for the share image come from this. Set SITE_URL to the public
  // origin in production; without it a link preview points at localhost.
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Katapatha",
  description: "Delivery coordination for Waypoint Group.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
