import type { Metadata } from "next";
import { Empty, PageHead } from "@/components/app/ui";

export const metadata: Metadata = { title: "Earnings" };

export default function Earnings() {
  return (
    <>
      <PageHead eyebrow="Earnings" title="What you made" />
      <Empty title="Nothing connected yet" body="Connect YouTube, TikTok or Stripe and your real earnings show up here." action={{ href: "/app/settings", label: "Connect an account" }} />
    </>
  );
}
