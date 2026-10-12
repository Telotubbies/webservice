// FaceplateContext — global tag-keyed faceplate state (spec §3.3-B). The
// active tag lives in the URL as ?fp=<tag> so a faceplate is linkable and
// survives refresh. The legacy /line?eq=<equipment> param also feeds it: the
// equipment's primary signal becomes the active tag (prior ruling — the UAT
// drives ?eq=motor and expects the motor controls to appear).

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { EQUIPMENT } from '../../lib/plant';

export interface FaceplateState {
  activeTag: string | null;
  openFaceplate: (tag: string) => void;
  closeFaceplate: () => void;
}

const Ctx = createContext<FaceplateState>({
  activeTag: null,
  openFaceplate: () => {},
  closeFaceplate: () => {},
});

export function useFaceplate(): FaceplateState {
  return useContext(Ctx);
}

/** Primary (first) signal of an equipment id — the tag `/line?eq=` maps to. */
export function primaryTagOf(eq: string | null): string | null {
  if (!eq) return null;
  return EQUIPMENT.find((e) => e.id === eq)?.signals[0] ?? null;
}

export function FaceplateProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const fp = params.get('fp');
  // ?fp wins when both are present; ?eq only applies on the line view.
  const eqTag = pathname === '/line' ? primaryTagOf(params.get('eq')) : null;
  const activeTag = fp ?? eqTag;

  const openFaceplate = useCallback((tag: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('fp', tag);
      return next;
    });
  }, [setParams]);

  const closeFaceplate = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('fp');
      next.delete('eq'); // closing also clears the equipment selection, as before
      return next;
    }, { replace: true });
  }, [setParams]);

  const value = useMemo<FaceplateState>(
    () => ({ activeTag, openFaceplate, closeFaceplate }),
    [activeTag, openFaceplate, closeFaceplate],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
