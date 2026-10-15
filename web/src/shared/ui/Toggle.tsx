// Toggle — measured dd switch: track 37×21 pill, on-bg #006bc2, 15×15 white thumb.

export function Toggle({ on, onChange, label, disabled }: {
  on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[21px] w-[37px] shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'bg-blue' : 'bg-line-hard'
      }`}
    >
      <span
        className={`absolute top-[3px] h-[15px] w-[15px] rounded-full bg-white shadow-card transition-transform ${
          on ? 'translate-x-[19px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}
