import { readStoredAccessToken } from "./auth";

export type UploadPurpose = "catalog" | "accessories" | "reviews" | "handover" | "refund-proof";

/** Upload to the Next.js security boundary with the current backend-issued token. */
export async function uploadFile(file: File, purpose: UploadPurpose) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", purpose);
  const token = readStoredAccessToken();
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const payload = (await response.json().catch(() => null)) as { success?: boolean; url?: string; message?: string } | null;
  if (!response.ok || !payload?.success || !payload.url) {
    throw new Error(payload?.message || "Upload failed");
  }
  return payload.url;
}

export async function deleteUploadedFile(url: string, bucket?: string) {
  const token = readStoredAccessToken();
  const response = await fetch("/api/upload", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url, ...(bucket ? { bucket } : {}) }),
  });
  return response.ok;
}
