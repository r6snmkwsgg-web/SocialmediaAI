import type { Metadata } from "next";
import { Empty, PageHead } from "@/components/app/ui";

export const metadata: Metadata = { title: "Shorts" };

export default function Shorts() {
  return (
    <>
      <PageHead eyebrow="Shorts" title="Your queue" />
      <Empty title="No Shorts yet" body="Each morning a few new Shorts land here, made for your channel. Swipe right to post one, left for a different one." />
    </>
  );
}
