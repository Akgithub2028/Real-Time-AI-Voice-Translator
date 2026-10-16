import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — Voice Translator · elevenlabs.io",
  description:
    "Speak naturally, read bilingual captions, and hear your words in a new language. A free, non-commercial voice translation demo.",
  authors: [{ name: "Aayaann Kausar", url: "https://github.com/Akgithub2028" }],
  creator: "Aayaann Kausar",
  icons: { icon: "/relay.svg", apple: "/relay.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
