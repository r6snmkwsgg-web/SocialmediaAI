import type { Metadata } from "next";
import { Empty, PageHead } from "@/components/app/ui";

export const metadata: Metadata = { title: "Live" };

export default function Live() {
  return (
    <>
      <PageHead eyebrow="Live" title="Your LIVE game" />
      <Empty title="Not set up yet" body="Pick a game and your gift prices, then add it to TikTok LIVE Studio." action={{ href: "/live#setup", label: "Set it up" }} />
    </>
  );
}
