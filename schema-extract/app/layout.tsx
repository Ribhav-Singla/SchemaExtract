import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Schema Extract",
  description: "Find the most relevant evidence in a PDF using your JSON schema.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}