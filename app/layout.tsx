import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matmakt",
  description: "Felles prisdata for smartere husholdninger",
  icons: { icon: "/favicon.svg" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
