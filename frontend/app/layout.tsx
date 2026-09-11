import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Real-Time Voice Translator",
  description: "Speak in any language, hear it translated live.",
  authors: [{ name: "Aayaann Kausar", url: "https://github.com/Akgithub2028" }],
  creator: "Aayaann Kausar",
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
