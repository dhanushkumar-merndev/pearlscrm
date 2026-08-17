import type { Metadata } from "next";
import { Playfair_Display, Plus_Jakarta_Sans } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const playfair = Playfair_Display({ variable: "--font-serif", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Pearls Aesthetic Clinic Library",
    // Page titles carry case IDs only — never anything patient-identifying.
    template: "%s · Pearls Aesthetic",
  },
  description: "Secure clinical case library for Pearls Aesthetic Clinic.",
  robots: { index: false, follow: false, nocache: true },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
