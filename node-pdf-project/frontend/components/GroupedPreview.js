export function GroupedPreview({ grouped, selectedCount }) {
  const categories = Object.keys(grouped);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-semibold text-slate-900">Selected (grouped)</div>
        <div className="text-sm text-slate-600">{selectedCount} items</div>
      </div>

      {selectedCount === 0 ? (
        <div className="mt-3 text-sm text-slate-500">No products selected.</div>
      ) : (
        <div className="mt-3 space-y-3">
          {categories.map((c) => (
            <div key={c} className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">{c}</div>
              <div className="mt-2 text-sm text-slate-600">
                {grouped[c].map((p) => p.name).join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
