import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

type AppRole = "customer" | "staff" | "manager_owner" | "admin";
type UploadPurpose = "catalog" | "accessories" | "reviews" | "handover" | "refund-proof";
type Identity = { id: string; role: AppRole; isActive: boolean };

type UploadPolicy = {
  bucket: string;
  roles: readonly AppRole[];
  maxBytes: number;
  allowVideo: boolean;
  deletable: boolean;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;

function configuredBucket(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function policies(): Record<UploadPurpose, UploadPolicy> {
  return {
    catalog: {
      bucket: configuredBucket("SUPABASE_ASSETS_BUCKET", "products"),
      roles: ["manager_owner", "admin"],
      maxBytes: MAX_IMAGE_BYTES,
      allowVideo: false,
      deletable: true,
    },
    accessories: {
      bucket: "accessories",
      roles: ["manager_owner", "admin"],
      maxBytes: MAX_IMAGE_BYTES,
      allowVideo: false,
      deletable: true,
    },
    reviews: {
      bucket: "reviews",
      roles: ["customer"],
      maxBytes: MAX_VIDEO_BYTES,
      allowVideo: true,
      deletable: false,
    },
    handover: {
      bucket: configuredBucket("SUPABASE_ASSETS_BUCKET", "products"),
      roles: ["staff", "manager_owner", "admin"],
      maxBytes: MAX_IMAGE_BYTES,
      allowVideo: false,
      deletable: false,
    },
    "refund-proof": {
      bucket: configuredBucket("SUPABASE_ASSETS_BUCKET", "products"),
      roles: ["manager_owner", "admin"],
      maxBytes: MAX_IMAGE_BYTES,
      allowVideo: false,
      deletable: false,
    },
  };
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function bearerToken(request: NextRequest) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function authenticate(request: NextRequest): Promise<Identity | NextResponse> {
  const token = bearerToken(request);
  if (!token) return errorResponse("Authentication required", 401);

  const apiBase = (process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
  try {
    const response = await fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return errorResponse("Authentication failed", 401);
    const payload = (await response.json()) as { success?: boolean; data?: Partial<Identity> };
    const identity = payload.data;
    if (
      !payload.success ||
      !identity ||
      typeof identity.id !== "string" ||
      !["customer", "staff", "manager_owner", "admin"].includes(identity.role ?? "") ||
      identity.isActive !== true
    ) {
      return errorResponse("Authentication failed", 401);
    }
    return identity as Identity;
  } catch {
    // Do not fail open when the identity service is unavailable.
    return errorResponse("Authentication unavailable", 503);
  }
}

function requestedPurpose(data: FormData): UploadPurpose | null {
  const value = data.get("purpose");
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(policies(), value)) {
    return value as UploadPurpose;
  }

  // Temporary compatibility for existing callers. The bucket is still mapped to a
  // fixed policy and can never introduce a new bucket or path.
  const bucket = data.get("bucket");
  if (typeof bucket !== "string") return null;
  return (Object.entries(policies()).find(([, policy]) => policy.bucket === bucket)?.[0] as UploadPurpose | undefined) ?? null;
}

async function hasValidSignature(file: File, mimeType: string) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  if (mimeType === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (mimeType === "video/mp4") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  if (mimeType === "video/webm") return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}

function extensionFor(mimeType: string) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
}

function isResponse(value: Identity | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function POST(req: NextRequest) {
  const identity = await authenticate(req);
  if (isResponse(identity)) return identity;

  try {
    const data = await req.formData();
    const purpose = requestedPurpose(data);
    const policy = purpose ? policies()[purpose] : null;
    const file = data.get("file");
    if (!policy || !file || typeof file === "string") return errorResponse("Invalid upload purpose or file", 400);
    if (!policy.roles.includes(identity.role)) return errorResponse("You are not allowed to upload this file", 403);

    const contentType = file.type.toLowerCase();
    const isImage = IMAGE_TYPES.has(contentType);
    const isVideo = VIDEO_TYPES.has(contentType);
    if ((!isImage && (!isVideo || !policy.allowVideo)) || file.size <= 0 || file.size > policy.maxBytes || (isVideo && file.size > MAX_VIDEO_BYTES)) {
      return errorResponse("Unsupported file type or size", 400);
    }
    if (!(await hasValidSignature(file, contentType))) return errorResponse("File content does not match its type", 400);

    const objectPath = `${purpose}/${identity.id}/${randomUUID()}.${extensionFor(contentType)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await getSupabaseAdmin().storage.from(policy.bucket).upload(objectPath, buffer, {
      contentType,
      upsert: false,
    });
    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return errorResponse("Supabase upload failed", 500);
    }

    const { data: publicUrlData } = getSupabaseAdmin().storage.from(policy.bucket).getPublicUrl(objectPath);
    return NextResponse.json({ success: true, url: publicUrlData.publicUrl });
  } catch (error) {
    console.error("Upload error:", error);
    return errorResponse("Upload failed", 500);
  }
}

function parseOwnedObject(urlValue: unknown, bucketValue: unknown, identity: Identity) {
  if (typeof urlValue !== "string" || !urlValue) return null;
  let url: URL;
  let supabaseUrl: URL;
  try {
    url = new URL(urlValue);
    supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  } catch {
    return null;
  }
  if (url.origin !== supabaseUrl.origin) return null;

  const allPolicies = policies();
  const bucket = typeof bucketValue === "string" && bucketValue ? bucketValue : null;
  const match = Object.entries(allPolicies).find(([, policy]) => policy.bucket === bucket || (!bucket && url.pathname.includes(`/object/public/${policy.bucket}/`)));
  if (!match) return null;
  const [purpose, policy] = match as [UploadPurpose, UploadPolicy];
  const marker = `/storage/v1/object/public/${policy.bucket}/`;
  if (!url.pathname.startsWith(marker) || url.search || url.hash) return null;
  const objectPath = decodeURIComponent(url.pathname.slice(marker.length));
  const pathPattern = new RegExp(`^${purpose}/([0-9a-f-]{36})/([0-9a-f-]{36})\\.(jpg|png|webp|mp4|webm)$`, "i");
  const pathMatch = pathPattern.exec(objectPath);
  if (!pathMatch || !policy.deletable) return null;
  if (identity.role !== "admin" && pathMatch[1] !== identity.id) return null;
  return { bucket: policy.bucket, objectPath };
}

export async function DELETE(req: NextRequest) {
  const identity = await authenticate(req);
  if (isResponse(identity)) return identity;

  try {
    const body = (await req.json()) as { url?: unknown; bucket?: unknown };
    const object = parseOwnedObject(body.url, body.bucket, identity);
    // Unknown/legacy paths and all evidence buckets fail closed.
    if (!object) return errorResponse("Invalid or protected object", 403);
    const { error } = await getSupabaseAdmin().storage.from(object.bucket).remove([object.objectPath]);
    if (error) {
      console.error("Supabase delete error:", error);
      return errorResponse("Delete failed", 500);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return errorResponse("Delete failed", 400);
  }
}
