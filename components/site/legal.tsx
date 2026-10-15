import { SiteFooter, SiteHeader } from "./chrome";

/** A plain page of plain words, for terms and privacy. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="overflow-x-clip">
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-8 lg:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">Updated {updated}</p>
        <h1 className="mt-3 font-display text-[clamp(3rem,7vw,5.4rem)] uppercase leading-[0.92]">{title}</h1>
        <div className="mt-10 flex flex-col gap-6 text-[16px] leading-relaxed text-paper/80 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-3xl [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:text-paper [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_a]:underline [&_a]:decoration-signal [&_a]:underline-offset-4">
          {children}
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}

/** Who to write to: set NEXT_PUBLIC_CONTACT_EMAIL. */
export function Contact() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return email ? <a href={`mailto:${email}`}>{email}</a> : <>the contact address on this site</>;
}
