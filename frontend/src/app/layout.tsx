import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { CustomerChatProvider } from "@/components/chat/customer-chat-provider";
import { SmoothScrollProvider } from "@/components/common/smooth-scroll-provider";
import { FloatingHeritageCompanion } from "@/components/mascot";

export const metadata: Metadata = {
  title: "Cổ Phục Rental ERP",
  description: "Landing page và cổng đăng nhập cho hệ thống ERP thuê cổ phục, áo dài Việt Nam có thử đồ AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap"
        />
      </head>
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
