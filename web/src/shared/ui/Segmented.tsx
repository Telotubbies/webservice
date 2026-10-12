interface Option<T extends string> { value: T; label: string }

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
