import { useStore } from '../store/useStore';
import type { ProductType } from '../types';
import { formatCurrency, groupProductsByCategory } from '../lib/utils';

interface Props {
  value: ProductType;
  onChange: (p: ProductType) => void;
}

export function ProductPicker({ value, onChange }: Props) {
  const products = useStore((s) => s.settings.products);

  const grouped = groupProductsByCategory(products);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ProductType)}
      style={{ width: '100%' }}
    >
      {grouped.map((g) => (
        <optgroup key={g.category} label={g.category}>
          {g.products.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} — {formatCurrency(p.commission)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
