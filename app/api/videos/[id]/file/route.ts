import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { fileOf } from "@/lib/server/shorts/queue";
import { localVideo, signedVideoUrl } from "@/lib/server/storage";

/** A rendered Short, for its owner: a signed link to storage, or the file itself on a developer's machine. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const f = await fileOf(me.id, id);
  if (!f) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = `${f.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "short"}.mp4`;
  const signed = await signedVideoUrl(f.key, download ? name : undefined);
  if (signed) return NextResponse.redirect(signed);
  const local = localVideo(f.key);
  if (!local) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(local.stream) as ReadableStream, {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(local.size),
      "cache-control": "private, max-age=300",
      ...(download ? { "content-disposition": `attachment; filename="${name}"` } : {}),
    },
  });
}
