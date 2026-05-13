import { useStore } from '../store/useStore';
import type { ProductType, ProductCategory } from '../types';
import { formatCurrency } from '../lib/utils';

interface Props {
  value: ProductType;
  onChange: (p: ProductType) => void;
}

const ORDER: ProductCategory[] = ['Privat', 'Business', 'Zusatz'];

export function ProductPicker({ value, onChange }: Props) {
  const products = useStore((s) => s.settings.products);

  const grouped = ORDER.map((cat) => ({
    category: cat,
    items: products.filter((p) => p.category === cat),
  }));

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ProductType)}
      style={{ width: '100%' }}
    >
      {grouped.map((g) => (
        <optgroup key={g.category} label={g.category}>
          {g.items.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} — {formatCurrency(p.commission)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
