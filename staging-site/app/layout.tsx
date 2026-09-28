import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GovernBright Staging",
  description: "Private staging environment for GovernBright AI governance.",
  other: {
    "codex-preview": "staging",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
