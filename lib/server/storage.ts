import "server-only";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { configured } from "./env";
import { supabaseAdmin } from "./supabase-admin";

/**
 * Where rendered videos live: a private Supabase Storage bucket, handed
 * out with short-lived signed links. With no Supabase (on a developer's
 * machine) they go in .data/videos instead and the app serves them
 * itself, signed-in only.
 */

const BUCKET = "videos";
const LOCAL = resolve(".data/videos");

let bucketReady = false;

async function bucket() {
  const sb = supabaseAdmin();
  if (!bucketReady) {
    const { data } = await sb.storage.getBucket(BUCKET);
    if (!data) await sb.storage.createBucket(BUCKET, { public: false });
    bucketReady = true;
  }
  return sb.storage.from(BUCKET);
}

/** Keeps a rendered file at `key`, like `<user>/<video>.mp4`. */
export async function putVideo(key: string, file: string): Promise<void> {
  if (configured().storage) {
    const { error } = await (await bucket()).upload(key, readFileSync(file), { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
    return;
  }
  const to = join(LOCAL, key);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(file));
}

/** The file's bytes, for posting it somewhere. */
export async function getVideo(key: string): Promise<Buffer> {
  if (configured().storage) {
    const { data, error } = await (await bucket()).download(key);
    if (error || !data) throw new Error(`download failed: ${error?.message ?? "no file"}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return readFileSync(join(LOCAL, key));
}

/** A link that works for a few minutes, for downloading or for a platform to fetch it. Null when it's served locally. */
export async function signedVideoUrl(key: string, download?: string): Promise<string | null> {
  if (!configured().storage) return null;
  const { data, error } = await (await bucket()).createSignedUrl(key, 600, download ? { download } : undefined);
  if (error || !data) throw new Error(`couldn't sign a link: ${error?.message}`);
  return data.signedUrl;
}

/** A local file to stream, on a developer's machine. */
export function localVideo(key: string): { stream: ReturnType<typeof createReadStream>; size: number } | null {
  const p = join(LOCAL, key);
  if (!p.startsWith(LOCAL) || !existsSync(p)) return null;
  return { stream: createReadStream(p), size: statSync(p).size };
}

/** Everything under a prefix, like a deleted account's folder. */
export async function removeVideos(prefix: string): Promise<void> {
  if (configured().storage) {
    const b = await bucket();
    const { data } = await b.list(prefix, { limit: 1000 });
    if (data?.length) await b.remove(data.map((f) => `${prefix}/${f.name}`));
    return;
  }
  rmSync(join(LOCAL, prefix), { recursive: true, force: true });
}
