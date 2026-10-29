/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Tự động chuyển đổi sang AVIF và WebP cho mọi ảnh qua next/image
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 ngày cache
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // [SECURITY FIX] Xóa bỏ wildcard hostname "**" để ngăn SSRF qua /_next/image proxy
    // Chỉ cho phép các domain ảnh tin cậy đã biết trước
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "dep.com.vn",
      },
      {
        // Domain ảnh của shop Cổ Phục Hoàng Thanh Huế
        protocol: "https",
        hostname: "cophuchoangthanhhue.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.replicate.delivery",
      },
      {
        protocol: "https",
        hostname: "pbxt.replicate.delivery",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        // Google Thumbnail CDN (ảnh tìm kiếm / Maps được cache bởi Google)
        protocol: "https",
        hostname: "encrypted-tbn0.gstatic.com",
      },
      {
        // Sapo/DKT CDN — nền tảng thương mại điện tử Việt Nam
        protocol: "https",
        hostname: "bizweb.dktcdn.net",
      },
      {
        // Sapo/DKT CDN — nền tảng thương mại điện tử Việt Nam
        protocol: "https",
        hostname: "img.lazcdn.com",
      },
      {
        // Sapo/DKT CDN — nền tảng thương mại điện tử Việt Nam
        protocol: "https",
        hostname: "overabridal.com",
      },
      {
        // Sapo/DKT CDN — nền tảng thương mại điện tử Việt Nam
        protocol: "https",
        hostname: "lamia.com.vn",
      },
      {
        // Sapo/DKT CDN — nền tảng thương mại điện tử Việt Nam
        protocol: "https",
        hostname: "media-cdn-v2.laodong.vn",
      },
      {
        // Sapo/DKT CDN — nền tảng thương mại điện tử Việt Nam
        protocol: "https",
        hostname: "aodaitailoc.com",
      },



    ],
  },
  // [SECURITY FIX] Tắt header X-Powered-By để không lộ công nghệ backend
  poweredByHeader: false,
  // Bỏ qua ESLint warnings khi build production (try-on camera components dùng
  // <img> với blob: URL từ webcam — không thể dùng next/image với blob URLs)
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "leaflet"],
  },
  // [SECURITY FIX] Thêm các HTTP security headers cho toàn bộ routes
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Ngăn clickjacking: trang web của mình không thể bị nhúng vào iframe của site khác
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          // Ngăn MIME-sniffing: browser không được tự đoán content type
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          // Kiểm soát thông tin Referrer gửi khi click link sang site khác
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Hạn chế các browser API nhạy cảm chỉ cho phép từ origin chính
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(self)",
          },
          // CSP ở chế độ Report-Only: theo dõi vi phạm mà không làm hỏng app
          // Khi production ổn định, đổi key thành "Content-Security-Policy" để enforce
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.supabase.co https://res.cloudinary.com https://dep.com.vn https://images.unsplash.com https://*.replicate.delivery https://pbxt.replicate.delivery https://lh3.googleusercontent.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://localhost:* https://localhost:* wss://localhost:* https://api.gogoduk.com https://rsapi.goong.io https://maps.goong.io https://openrouter.ai https://*.replicate.com https://*.replicate.delivery https://decart.ai wss://*.decart.ai",
              "frame-src 'self' https://accounts.google.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
