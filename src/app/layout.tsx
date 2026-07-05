import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "StreamVault - IPTV Player",
  description: "Professional IPTV & M3U playlist player",
  applicationName: "StreamVault",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StreamVault",
  },
};

// Réglé pour fonctionner aussi bien sur mobile Android que sur navigateurs TV :
// - width=device-width + initialScale évite le zoom/mise à l'échelle foireuse sur téléphone
// - maximumScale/userScalable désactivés pour ne pas casser l'UI avec un pinch-zoom accidentel
// - viewportFit=cover permet de gérer les zones de sécurité (encoches / overscan TV)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-[100dvh] antialiased">{children}</body>
    </html>
  );
}
