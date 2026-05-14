export function ProductCard({ product, checked, onToggle }) {
  return (
    <label className="group block rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow transition">
      <div className="relative h-40 bg-slate-50 flex items-center justify-center p-3">
        <img
          src={product.image}
          alt={product.name}
          className="h-full w-full object-contain"
          loading="lazy"
        />
        <div className="absolute top-3 right-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(product.id)}
            className="h-5 w-5 accent-green-600"
          />
        </div>
      </div>
      <div className="p-4">
        <div className="font-semibold text-slate-900 leading-snug min-h-[44px]">
          {product.name}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <div className="text-slate-600">{product.size}</div>
          <div className="font-bold text-slate-900">₹{product.price}</div>
        </div>
        <div className="mt-3 text-xs text-slate-500">{product.category}</div>
      </div>
    </label>
  );
}
