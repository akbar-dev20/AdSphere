import { Coffee, ShoppingBag, TentTree, BedDouble, Sparkles } from "lucide-react";

const categories = [
  { name: "All", label: "All", icon: Sparkles },
  { name: "Eat", label: "Eat", icon: Coffee },
  { name: "Shop", label: "Shop", icon: ShoppingBag },
  { name: "Play", label: "Play", icon: TentTree },
  { name: "Stay", label: "Stay", icon: BedDouble },
  { name: "Services", label: "Services", icon: Sparkles },
];

export default function CategoryNav({ value, onChange }) {
  return <nav className="category-nav" aria-label="Business categories">
    {categories.map(({ name, label, icon: Icon }) => <button key={name} className={`category-button ${value === name ? "active" : ""}`} onClick={() => onChange(name)}><Icon size={18} /><span>{label}</span></button>)}
  </nav>;
}
