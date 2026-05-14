import { useEffect, useMemo, useState } from 'react';
import { ProductCard } from '../components/ProductCard';
import { GroupedPreview } from '../components/GroupedPreview';

function groupByCategory(products) {
  return products.reduce((acc, p) => {
    const key = p.category || 'Uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});
}

export default function HomePage() {
  const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

  const [products, setProducts] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${backendBaseUrl}/products`)
      .then((r) => r.json())
      .then((data) => setProducts(Array.isArray(data?.products) ? data.products : []))
      .catch(() => setProducts([]));
  }, [backendBaseUrl]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (categoryFilter === 'All') return products;
    return products.filter((p) => p.category === categoryFilter);
  }, [products, categoryFilter]);

  const selectedProducts = useMemo(() => {
    return products.filter((p) => selectedIds.has(p.id));
  }, [products, selectedIds]);

  const groupedSelected = useMemo(() => groupByCategory(selectedProducts), [selectedProducts]);

  const selectedCount = selectedIds.size;

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of filteredProducts) next.add(p.id);
      return next;
    });
  }

  function clearAll() {
    setSelectedIds(new Set());
  }

  async function generateBrochure() {
    if (selectedCount === 0) {
      alert('Select at least 1 product');
      return;
    }

    setBusy(true);
    try {
      const resp = await fetch(`${backendBaseUrl}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: Array.from(selectedIds) })
      });

      if (!resp.ok) {
        const msg = await resp.text();
        throw new Error(msg || 'Failed to generate PDF');
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      window.open(url, '_blank', 'noopener,noreferrer');

      const a = document.createElement('a');
      a.href = url;
      a.download = 'brochure.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(`PDF generation failed. ${e?.message || ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col gap-2">
          <div className="text-2xl font-extrabold text-slate-900">Product Brochure Generator</div>
          <div className="text-sm text-slate-600">
            Select products, group by category automatically, and generate a print-ready PDF.
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-2">
                  <div className="text-sm font-semibold text-slate-900">Filters</div>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Select all (filtered)
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                  <div className="ml-1 text-sm text-slate-600">Selected: {selectedCount}</div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  checked={selectedIds.has(p.id)}
                  onToggle={toggleOne}
                />
              ))}
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="sticky top-6 space-y-4">
              <GroupedPreview grouped={groupedSelected} selectedCount={selectedCount} />

              <button
                type="button"
                disabled={busy}
                onClick={generateBrochure}
                className="w-full h-11 rounded-xl bg-green-600 text-white font-extrabold hover:bg-green-700 disabled:opacity-60"
              >
                {busy ? 'Generating…' : 'Generate Brochure'}
              </button>

              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                The PDF opens inline in a new tab and also triggers a download.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
