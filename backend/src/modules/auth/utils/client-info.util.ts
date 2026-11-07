export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface ClientInfo {
  ip: string;
  userAgent: string;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
}

/**
 * Parses client information from an incoming HTTP request for security auditing.
 * Masks partial IP addresses for privacy compliance while retaining diagnostic value.
 */
export function extractClientInfo(req: RequestLike): ClientInfo {
  const forwardedFor = req.headers["x-forwarded-for"];
  const rawIp =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : null) ||
    req.socket?.remoteAddress ||
    req.ip ||
    "127.0.0.1";

  const rawUserAgent = req.headers["user-agent"];
  const userAgent = (Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent) || "unknown";

  const { browser, os, deviceType } = parseUserAgent(userAgent);

  return {
    ip: sanitizeIp(rawIp),
    userAgent: userAgent.slice(0, 500),
    browser,
    os,
    deviceType,
  };
}

/**
 * Basic lightweight User-Agent heuristic parser without external library dependencies.
 */
function parseUserAgent(ua: string): {
  browser: string;
  os: string;
  deviceType: ClientInfo["deviceType"];
} {
  const lower = ua.toLowerCase();

  // Device type
  let deviceType: ClientInfo["deviceType"] = "desktop";
  if (/bot|crawler|spider|crawling/i.test(lower)) {
    deviceType = "bot";
  } else if (/ipad|tablet|(android(?!.*mobile))/i.test(lower)) {
    deviceType = "tablet";
  } else if (/mobile|iphone|ipod|android/i.test(lower)) {
    deviceType = "mobile";
  }

  // OS
  let os = "Unknown OS";
  if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("mac os") || lower.includes("macintosh")) os = "macOS";
  else if (lower.includes("android")) os = "Android";
  else if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ios")) os = "iOS";
  else if (lower.includes("linux")) os = "Linux";

  // Browser
  let browser = "Unknown Browser";
  if (lower.includes("edg/")) browser = "Microsoft Edge";
  else if (lower.includes("chrome/") && !lower.includes("chromium")) browser = "Chrome";
  else if (lower.includes("firefox/")) browser = "Firefox";
  else if (lower.includes("safari/") && !lower.includes("chrome")) browser = "Safari";
  else if (lower.includes("opera") || lower.includes("opr/")) browser = "Opera";

  return { browser, os, deviceType };
}

/**
 * Masks the last octet of IPv4 or last segments of IPv6 to balance security tracking with user privacy.
 */
function sanitizeIp(ip: string): string {
  if (!ip) return "127.0.0.1";
  const clean = ip.replace(/^::ffff:/, "");
  if (clean.includes(".")) {
    const parts = clean.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
    }
  }
  return clean;
}
