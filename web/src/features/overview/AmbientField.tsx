// AmbientField — fullscreen <canvas> mounted by OverviewPage, painted UNDER
// all content (z-index: -1). All drawing/suppression logic lives in
// ambientField.ts; this file is only the React mount. The canvas is
// aria-hidden decorative chrome — never interactive. Unmounting (leaving
// "/") disposes the engine: zero DOM/render cost off the overview.
//
// Calm mode: the topbar toggle (useCalm/setCalm) persists wds.calm and sets
// `.calm` on <html>; while on, the engine renders one static contour frame.

import { useEffect, useRef } from 'react';
import { startAmbientField, useCalm } from './ambientField';

export { isCalm, setCalm, useCalm } from './ambientField';

export function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const calm = useCalm();

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    return startAmbientField(cv, () => calm);
  }, [calm]);

  return <canvas ref={ref} className="ambient-field" aria-hidden="true" />;
}
