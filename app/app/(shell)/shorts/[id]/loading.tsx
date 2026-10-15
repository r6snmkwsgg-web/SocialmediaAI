/** A Short's page while it loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading this Short" className="grid gap-8 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="skeleton mx-auto aspect-[9/16] w-full max-w-[340px] rounded-[2.4rem]" />
      <div className="flex flex-col gap-4">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-9 w-full" />
        <div className="skeleton h-16 w-full" />
        <div className="skeleton h-32 w-full" />
        <div className="skeleton h-48 w-full" />
      </div>
    </div>
  );
}
