/** While today's Shorts are being made: the shape of the queue, breathing. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Making your Shorts">
      <div className="mb-8 flex flex-col gap-3">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-12 w-72" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="skeleton mx-auto aspect-[9/16] w-full max-w-[340px] rounded-[2.4rem]" />
        <div className="flex flex-col gap-4">
          <div className="skeleton h-5 w-24" />
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-24 w-full" />
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Making today&rsquo;s Shorts…</p>
        </div>
      </div>
    </div>
  );
}
