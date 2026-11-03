import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import './styles/shell.css';
import './styles/volunteer.css';
import './styles/bpbd.css';
import './styles/landing.css';
import { SessionProvider } from './session';
import { LangProvider } from './i18n';
import { RegionProvider } from './region';
import { DataVersionProvider } from './components/ui';
import { startOutboxSync } from './outbox';
import { DemoLink } from './components/shell/DemoLink';
import { AppRoutes } from './AppRoutes';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
startOutboxSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <SessionProvider>
        <RegionProvider>
          <DataVersionProvider>
            <BrowserRouter>
              <DemoLink>
                <AppRoutes />
              </DemoLink>
            </BrowserRouter>
          </DataVersionProvider>
        </RegionProvider>
      </SessionProvider>
    </LangProvider>
  </StrictMode>,
);
