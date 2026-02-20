"use client";

export interface BasicFilters {
  category: string;
  priceTier: string;
  openNow: boolean;
  radiusKm: number;
  keyword: string;
}

const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "coffee shop", label: "Coffee & cafés" },
  { value: "restaurant", label: "Restaurants" },
  { value: "bakery", label: "Bakeries" },
  { value: "bar", label: "Bars & pubs" },
  { value: "hotel", label: "Hotels" },
  { value: "park", label: "Parks" },
  { value: "gym", label: "Gyms & fitness" },
  { value: "spa", label: "Spas & wellness" },
  { value: "bookstore", label: "Bookstores" },
  { value: "grocery", label: "Groceries & markets" },
  { value: "museum", label: "Museums" },
  { value: "library", label: "Libraries" },
  { value: "nightlife", label: "Nightlife" },
];

const PRICE_TIERS = [
  { value: "", label: "Any price" },
  { value: "cheap", label: "Budget-friendly" },
  { value: "moderate", label: "Moderate" },
  { value: "expensive", label: "Upscale" },
];

const RADII_KM = [1, 2, 3, 5, 10, 15, 20];

const DEFAULT_FILTERS: BasicFilters = {
  category: "coffee shop",
  priceTier: "",
  openNow: false,
  radiusKm: 5,
  keyword: "",
};

interface FilterSidebarProps {
  filters: BasicFilters;
  onChange: (f: BasicFilters) => void;
  onSearch: () => void;
  loading?: boolean;
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "0.4rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "0.9rem",
};

export function FilterSidebar({ filters, onChange, onSearch, loading }: FilterSidebarProps) {
  const update = (patch: Partial<BasicFilters>) => onChange({ ...filters, ...patch });

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        background: "var(--surface)",
        borderRadius: "var(--radius)",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        boxShadow: "var(--shadow)",
        border: "1px solid var(--border)",
      }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, fontFamily: "Fraunces, Georgia, serif" }}>
        Filters
      </h2>

      <div>
        <label style={labelStyle}>Category</label>
        <select
          value={filters.category}
          onChange={(e) => update({ category: e.target.value })}
          style={inputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value || "any"} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Price</label>
        <select
          value={filters.priceTier}
          onChange={(e) => update({ priceTier: e.target.value })}
          style={inputStyle}
        >
          {PRICE_TIERS.map((p) => (
            <option key={p.value || "any"} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.9rem",
            cursor: "pointer",
            color: "var(--text)",
          }}
        >
          <input
            type="checkbox"
            checked={filters.openNow}
            onChange={(e) => update({ openNow: e.target.checked })}
            style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
          />
          Open now
        </label>
      </div>

      <div>
        <label style={labelStyle}>Within</label>
        <select
          value={filters.radiusKm}
          onChange={(e) => update({ radiusKm: Number(e.target.value) })}
          style={inputStyle}
        >
          {RADII_KM.map((r) => (
            <option key={r} value={r}>
              {r} km
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Keyword</label>
        <input
          type="text"
          value={filters.keyword}
          onChange={(e) => update({ keyword: e.target.value })}
          placeholder="e.g. quiet, wifi, outdoor"
          style={inputStyle}
        />
      </div>

      <button
        type="button"
        onClick={onSearch}
        disabled={loading}
        style={{
          marginTop: "auto",
          padding: "0.75rem 1.25rem",
          borderRadius: "var(--radius-sm)",
          border: "none",
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
          fontSize: "0.95rem",
        }}
      >
        {loading ? "Searching…" : "Search"}
      </button>
    </aside>
  );
}

export { DEFAULT_FILTERS };
