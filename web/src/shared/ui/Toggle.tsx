// Toggle — switch: track 37×21 pill, accent when on, 15×15 white thumb.
// The thumb is pinned to left-0: without it an absolute child starts at the
// button's centred static position and slid out over the label ("nabled").

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
        className={`absolute left-0 top-[3px] h-[15px] w-[15px] rounded-full bg-paper shadow-[0_1px_2px_rgb(24_32_42/0.3)] transition-transform ${
          on ? 'translate-x-[19px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}
