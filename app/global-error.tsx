"use client";

/** The last resort, when even the page around everything failed: plain, with its own page skeleton. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0b0b0c", color: "#f4f1ea", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ padding: 24, maxWidth: 560 }}>
          <h1 style={{ fontSize: 40, lineHeight: 1, textTransform: "uppercase", margin: 0 }}>Hookline didn&rsquo;t load</h1>
          <p style={{ color: "#8d8a83", lineHeight: 1.5 }}>It&rsquo;s on our side. Try again in a moment.{error.digest ? ` Code: ${error.digest}` : ""}</p>
          <button type="button" onClick={reset} style={{ background: "#ff4a1c", color: "#0b0b0c", border: 0, padding: "12px 20px", fontWeight: 700, textTransform: "uppercase", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
