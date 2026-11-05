// Segmented — dd "Visualize as" toggle group (measured h28 container, r4).
// Buttons carry aria-pressed (toggle-button group semantics); each stays
// Tab-focusable — no roving tabindex, matching native dd behavior.

interface Option<T extends string> { value: T; label: string }

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          data-active={o.value === value}
          onClick={() => onChange(o.value)}
          /* .seg clips children (overflow:hidden) — ring-inset keeps the
             focus indicator visible instead of an outer outline */
          className="focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
