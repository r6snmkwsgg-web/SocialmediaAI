import type { Metadata } from "next";
import { Empty, PageHead } from "@/components/app/ui";

export const metadata: Metadata = { title: "Trends" };

export default function Trends() {
  return (
    <>
      <PageHead eyebrow="Trends" title="What's taking off" />
      <Empty title="Nothing measured yet" body="Shorts gaining views fastest in your niches, measured in views per hour, show up here." />
    </>
  );
}
