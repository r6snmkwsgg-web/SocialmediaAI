/** The league's shape while it loads: its table and its matches. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the Ball League">
      <div className="mb-8 flex flex-col gap-3">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-12 w-72" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <div className="skeleton mb-8 h-10 w-full max-w-3xl" />
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <div className="skeleton h-96 w-full" />
        <div className="skeleton h-[36rem] w-full lg:col-start-2 lg:row-start-1 lg:row-end-3" />
        <div className="skeleton h-48 w-full" />
      </div>
    </div>
  );
}
