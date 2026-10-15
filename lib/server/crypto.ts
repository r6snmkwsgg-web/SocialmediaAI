import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Secrets at rest: OAuth tokens and sellers' Stripe keys are stored
 * encrypted with AES-256-GCM, under a key that only the server has
 * (TOKEN_KEY). A database dump on its own reveals none of them.
 */

function key(): Buffer {
  const raw = env().TOKEN_KEY;
  if (!raw) throw new Error("TOKEN_KEY isn't set, so secrets can't be stored safely.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("TOKEN_KEY has to be 32 random bytes, base64.");
  return k;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}

export function open(sealed: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("Not a sealed value.");
  const buf = Buffer.from(sealed.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

/** A signature over a value, for cookies the server sets and checks itself. */
export function sign(value: string): string {
  const mac = createHmac("sha256", key()).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function unsign(signed: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const want = Buffer.from(createHmac("sha256", key()).update(value).digest("base64url"));
  const got = Buffer.from(signed.slice(i + 1));
  return want.length === got.length && timingSafeEqual(want, got) ? value : null;
}

/** A random token, for overlay keys and OAuth state. */
export function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
