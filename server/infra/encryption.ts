import crypto from "node:crypto";

const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;
const SEPARATOR = ".";

interface SealInput {
  key: Buffer;
  context: string;
  text: string;
}

interface OpenInput {
  key: Buffer;
  context: string;
  sealed: string;
}

function seal(input: SealInput): string {
  const { key, context, text } = input;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), data];
  return parts.map((part) => part.toString("base64url")).join(SEPARATOR);
}

function open(input: OpenInput): string | null {
  const { key, context, sealed } = input;
  const [iv, tag, data, ...rest] = sealed.split(SEPARATOR);
  if (iv === undefined || tag === undefined || data === undefined || rest.length > 0) return null;
  try {
    const decipher = crypto.createDecipheriv(CIPHER, key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
    return text.toString("utf8");
  } catch {
    return null;
  }
}

/** AES-256-GCM: the context is authenticated, so a value moved to another row does not open. */
export const encryption = { seal, open };
