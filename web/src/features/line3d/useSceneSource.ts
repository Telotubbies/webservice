// Where the twin's model + mapping come from: the site's active plant model
// (authenticated download) or, when none is uploaded, the bundled demo plant.

import { useCallback, useEffect, useState } from 'react';
import { subscribeScope, getScope } from '../../lib/scope';
import {
  DEMO_MODEL_URL, DEMO_PARTS, plantApi,
  type Kinds, type PlantModel, type PlantPart,
} from '../../lib/plantModel';

export interface SceneSource {
  status: 'loading' | 'ready' | 'error';
  url: string;
  parts: PlantPart[];
  model: PlantModel | null;   // null = bundled demo
  kinds: Kinds;
  reload: () => void;
}

const EMPTY: Kinds = {};

export function useSceneSource(): SceneSource {
  const [state, setState] = useState<Omit<SceneSource, 'reload'>>({
    status: 'loading', url: '', parts: [], model: null, kinds: EMPTY,
  });
  const [attempt, setAttempt] = useState(0);
  const [scopeKey, setScopeKey] = useState(() => getScope()?.siteId ?? '');
  useEffect(() => subscribeScope(() => setScopeKey(getScope()?.siteId ?? '')), []);

  useEffect(() => {
    let dead = false;
    let objectUrl = '';
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const kinds = await plantApi.kinds().catch(() => EMPTY);
        const { model, parts } = await plantApi.active();
        let url = DEMO_MODEL_URL;
        if (model) { url = objectUrl = await plantApi.fileUrl(model.id); }
        if (dead) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
        setState({ status: 'ready', url, parts: model ? parts : DEMO_PARTS, model, kinds });
      } catch {
        if (!dead) setState((s) => ({ ...s, status: 'error' }));
      }
    })();
    return () => { dead = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attempt, scopeKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
