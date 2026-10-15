/** The library's shape while it loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading your Shorts">
      <div className="mb-8 flex flex-col gap-3">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-12 w-72" />
      </div>
      <div className="skeleton mb-8 h-40 w-full" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[4/6]" />)}
      </div>
    </div>
  );
}
