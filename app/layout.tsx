import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KaamSathi | कामसाथी - WhatsApp AI Assistant for Gig Workers",
  description: "A GenAI assistant for gig and informal workers in India. Reliable schemes, rights, earnings tracking, and grievance drafting.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-200 flex justify-center items-center p-0 sm:p-4">
        {children}
      </body>
    </html>
  );
}
