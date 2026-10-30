import type { Metadata } from "next";
import { Manrope, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { CustomerChatProvider } from "@/components/chat/customer-chat-provider";
import { SmoothScrollProvider } from "@/components/common/smooth-scroll-provider";
import { FloatingHeritageCompanion } from "@/components/mascot";

const manrope = Manrope({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cổ Phục Rental ERP",
  description: "Landing page và cổng đăng nhập cho hệ thống ERP thuê cổ phục, áo dài Việt Nam có thử đồ AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${manrope.variable} ${cormorantGaramond.variable}`}>
      <body className="text-ink font-sans" suppressHydrationWarning>
        <AuthProvider>
          <SmoothScrollProvider>
            <CustomerChatProvider>
              {children}
            </CustomerChatProvider>
            <FloatingHeritageCompanion />
          </SmoothScrollProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
