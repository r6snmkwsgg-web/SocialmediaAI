/**
 * A phone around a Short, so a video on the page reads as what it is:
 * something you'd scroll past. The status bar sits above the video, like a
 * real phone, so nothing covers the video's first line. Position it with
 * the class you pass; it doesn't set its own.
 */
export function Phone({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[2.4rem] bg-[#19191b] p-[9px] shadow-[0_50px_90px_-30px_rgba(0,0,0,0.75),inset_0_0_0_1.5px_rgba(255,255,255,0.09)] ${className}`}>
      <div className="overflow-hidden rounded-[1.85rem] bg-ink">
        <div className="flex h-7 items-center justify-center bg-ink" aria-hidden="true">
          <span className="h-[14px] w-[30%] rounded-full bg-black" />
        </div>
        {children}
      </div>
    </div>
  );
}
