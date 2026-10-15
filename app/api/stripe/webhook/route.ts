import { handleWebhook } from "@/lib/server/billing";

/** Stripe's events, which keep each account's plan up to date. */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("No signature", { status: 400 });
  try {
    const did = await handleWebhook(await req.text(), signature);
    console.log(`stripe webhook: ${did}`);
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    console.error(`stripe webhook: ${msg}`);
    // a bad signature is the sender's problem; anything else, Stripe should retry
    return new Response(msg, { status: /signature/i.test(msg) ? 400 : 500 });
  }
}
