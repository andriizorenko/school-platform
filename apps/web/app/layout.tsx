import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School Platform",
  description: "Операційна платформа онлайн-школи",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="uk"><body>{children}</body></html>;
}
