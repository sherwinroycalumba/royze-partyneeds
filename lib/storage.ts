import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * File storage abstraction (Spec 5).
 *
 * Everything that uploads a file goes through here, so moving off
 * Supabase Storage to S3 later means rewriting this module only.
 */

export type Bucket = "branding" | "catalog" | "documents";

const MAX_BYTES: Record<Bucket, number> = {
  branding: 2 * 1024 * 1024,
  catalog: 5 * 1024 * 1024,
  documents: 10 * 1024 * 1024,
};

const ALLOWED_TYPES: Record<Bucket, readonly string[]> = {
  branding: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  catalog: ["image/png", "image/jpeg", "image/webp"],
  documents: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
};

export class UploadError extends Error {}

/** Strips anything that could escape the intended storage prefix. */
function safeExtension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(fileName);
  return match ? match[1].toLowerCase() : "bin";
}

/**
 * Uploads a file and returns its storage path.
 *
 * `prefix` groups files by entity, e.g. "payments/<paymentId>".
 * The filename is generated, never taken from the client.
 */
export async function uploadFile(
  bucket: Bucket,
  prefix: string,
  file: File,
): Promise<string> {
  if (file.size === 0) {
    throw new UploadError("The selected file is empty.");
  }

  if (file.size > MAX_BYTES[bucket]) {
    const mb = Math.round(MAX_BYTES[bucket] / (1024 * 1024));
    throw new UploadError(`File is too large. Maximum size is ${mb} MB.`);
  }

  if (!ALLOWED_TYPES[bucket].includes(file.type)) {
    throw new UploadError(
      `Unsupported file type. Allowed: ${ALLOWED_TYPES[bucket].join(", ")}.`,
    );
  }

  const path = `${prefix}/${crypto.randomUUID()}.${safeExtension(file.name)}`;

  const supabase = await createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new UploadError(`Upload failed: ${error.message}`);
  }

  return path;
}

/** Permanent public URL. Only valid for the public buckets. */
export async function getPublicUrl(
  bucket: Extract<Bucket, "branding" | "catalog">,
  path: string,
): Promise<string> {
  const supabase = await createClient();
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/** Time-limited URL for private files. Defaults to one hour. */
export async function getSignedUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error) return null;
  return data.signedUrl;
}

export async function deleteFile(bucket: Bucket, path: string): Promise<void> {
  const supabase = await createClient();
  await supabase.storage.from(bucket).remove([path]);
}
