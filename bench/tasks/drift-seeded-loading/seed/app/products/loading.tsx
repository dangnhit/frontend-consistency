export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <div className="mb-4 h-7 w-32 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </main>
  );
}
