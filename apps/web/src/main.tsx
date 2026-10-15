import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import { SessionProvider } from './session';
import { RegionProvider } from './region';
import { startOutboxSync } from './outbox';
import { IncidentList, IncidentPanel, MapScreen } from './pages/MapScreen';
import { LoginPage } from './pages/Login';
import { AlertsPage } from './pages/Alerts';
import { MyVillagesPage } from './pages/MyVillages';
import { VerifyPage } from './pages/Verify';
import { DashboardPage } from './pages/Dashboard';
import { VillagePage } from './pages/Village';
import { AboutPage } from './pages/About';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
startOutboxSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <RegionProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<MapScreen />}>
              <Route index element={<IncidentList />} />
              <Route path="/kejadian/:id" element={<IncidentPanel />} />
              <Route path="/k/:code" element={<IncidentPanel />} />
            </Route>
            <Route path="/kejadian/:id/cek" element={<VerifyPage />} />
            <Route path="/masuk" element={<LoginPage />} />
            <Route path="/peringatan" element={<AlertsPage />} />
            <Route path="/desa-saya" element={<MyVillagesPage />} />
            <Route path="/dasbor" element={<DashboardPage />} />
            <Route path="/desa/:id" element={<VillagePage />} />
            <Route path="/tentang" element={<AboutPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </RegionProvider>
    </SessionProvider>
  </StrictMode>,
);
