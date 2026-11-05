// App entrypoint — mounts the console into #root. The side-effect imports are
// order-sensitive: font faces first, i18n before App (it must be initialised
// before the first render), then the global stylesheet.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './lib/i18n';
import './index.css';
import App from './App.tsx';
import { registerServiceWorker } from './lib/pwa';
import { applyTheme, readThemePref } from './theme/theme';

// Paint the stored theme before the first render so a dark choice never
// flashes light. Unreadable storage resolves to the OS setting.
applyTheme(readThemePref());

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
