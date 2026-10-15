/** The month's shape while it loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the calendar">
      <div className="mb-8 flex flex-col gap-3">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-12 w-64" />
      </div>
      <div className="skeleton h-[32rem] w-full" />
    </div>
  );
}
