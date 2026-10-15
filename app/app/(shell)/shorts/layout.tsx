import { ShortsTabs } from "@/components/shorts/tabs";

/** Every Shorts screen, with the queue, calendar and library a tap apart. */
export default function ShortsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ShortsTabs />
      {children}
    </>
  );
}
