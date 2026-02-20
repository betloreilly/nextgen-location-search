import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Next-Gen Location Search",
  description: "Chat-based search with Basic, Semantic, and Advanced modes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
