import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

// Self-hosted by next/font at build time: no request leaves the browser to a
// font CDN, which keeps the app free of third-party requests on clinical pages.
const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const robotoMono = Roboto_Mono({ variable: "--font-mono", subsets: ["latin"] });

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
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
