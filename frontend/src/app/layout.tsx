import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DockPilot | Receiving Reconciliation Workbench",
  description:
    "Loading-dock voice and vision receiving workbench running Gemini 3.8 Live in asia-south1 with PO revision locks and CGST section 34 claim verification.",
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var saved = window.localStorage.getItem("dockpilot-theme");
    var mode = saved === "dark" ? "dark" : "light";
    var root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.dataset.theme = mode;
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink font-sans antialiased selection:bg-accent/20">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
