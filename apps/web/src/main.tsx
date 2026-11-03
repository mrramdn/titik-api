import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router';
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
import { installsServiceWorker } from './swRoutes';

startOutboxSync();

let serviceWorkerStarted = false;
/** Registers the service worker once the visitor is on a page that installs it (see installsServiceWorker). */
function ServiceWorker() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (serviceWorkerStarted || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    if (!installsServiceWorker(pathname, Boolean(navigator.serviceWorker.controller))) return;
    serviceWorkerStarted = true;
    void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
  }, [pathname]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <SessionProvider>
        <RegionProvider>
          <DataVersionProvider>
            <BrowserRouter>
              <ServiceWorker />
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
