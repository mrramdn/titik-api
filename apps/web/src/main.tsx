import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
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
import { IncidentList, IncidentPanel, MapScreen } from './pages/LazyMapScreen';
import { LoginPage } from './pages/Login';
import { TugasPage } from './pages/Tugas';
import { MyVillagesPage } from './pages/MyVillages';
import { VerifyPage } from './pages/Verify';
import { DashboardPage } from './pages/Dashboard';
import { RecapPage } from './pages/Recap';
import { VillagePage } from './pages/Village';
import { AboutPage } from './pages/About';
import { LandingPage } from './pages/Landing';
import { DemoLink } from './components/shell/DemoLink';
import { HOME_PATH, MAP_PATH } from './routes';

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
                <Routes>
                  {/* The landing page; an old map link on / (/?tanggal=…) goes on to /peta. */}
                  <Route index element={<LandingPage />} />
                  <Route element={<MapScreen />}>
                    <Route path={MAP_PATH} element={<IncidentList />} />
                    <Route path="/kejadian/:id" element={<IncidentPanel />} />
                    <Route path="/k/:code" element={<IncidentPanel />} />
                  </Route>
                  <Route path="/kejadian/:id/cek" element={<VerifyPage />} />
                  <Route path="/masuk" element={<LoginPage />} />
                  <Route path="/tugas" element={<TugasPage />} />
                  <Route path="/peringatan" element={<Navigate to="/tugas" replace />} />
                  <Route path="/desa-saya" element={<MyVillagesPage />} />
                  <Route path="/dasbor" element={<DashboardPage />} />
                  <Route path="/rekap" element={<RecapPage />} />
                  <Route path="/desa/:id" element={<VillagePage />} />
                  <Route path="/tentang" element={<AboutPage />} />
                  <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
                </Routes>
              </DemoLink>
            </BrowserRouter>
          </DataVersionProvider>
        </RegionProvider>
      </SessionProvider>
    </LangProvider>
  </StrictMode>,
);
