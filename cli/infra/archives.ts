import type { ArchiveBucket } from "./env.ts";

interface ArchiveUrls {
  download: string;
  upload: string;
}

interface ArchiveRequest {
  bucket: ArchiveBucket;
  key: string;
  expiresInSeconds: number;
}

interface ArchiveTarget {
  bucket: ArchiveBucket;
  key: string;
}

export const archives = { presign, remove };

function client(bucket: ArchiveBucket): Bun.S3Client {
  return new Bun.S3Client({
    endpoint: bucket.endpoint,
    bucket: bucket.bucket,
    region: bucket.region,
    accessKeyId: bucket.accessKey,
    secretAccessKey: bucket.secretKey,
  });
}

function presign(request: ArchiveRequest): ArchiveUrls {
  const s3 = client(request.bucket);
  const expiresIn = request.expiresInSeconds;
  return {
    download: s3.presign(request.key, { method: "GET", expiresIn }),
    upload: s3.presign(request.key, { method: "PUT", expiresIn }),
  };
}

async function remove(target: ArchiveTarget): Promise<boolean> {
  const s3 = client(target.bucket);
  const exists = await s3.exists(target.key);
  if (!exists) return false;
  await s3.delete(target.key);
  return true;
}
