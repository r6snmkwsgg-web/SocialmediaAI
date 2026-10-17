/** A LIVE's page while it loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading this LIVE" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="skeleton h-4 w-16" />
        <div className="skeleton h-12 w-72 max-w-full" />
        <div className="skeleton h-5 w-48" />
      </div>
      <div className="skeleton h-36 w-full" />
      <div className="skeleton h-24 w-full" />
      <div className="skeleton h-56 w-full" />
    </div>
  );
}
