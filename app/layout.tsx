import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-sans",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "צוות ה-AI שלי",
  description: "דשבורד לניהול צוותי שיווק ומיתוג מבוססי AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="h-full flex flex-col bg-background text-foreground">
        <DirectionProvider direction="rtl">{children}</DirectionProvider>
      </body>
    </html>
  );
}
