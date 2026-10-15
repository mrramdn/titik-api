import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { SessionProvider } from './session';
import { startOutboxSync } from './outbox';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { AlertsPage } from './pages/Alerts';
import { MyVillagesPage } from './pages/MyVillages';
import { IncidentPage } from './pages/Incident';
import { VerifyPage } from './pages/Verify';
import { DashboardPage } from './pages/Dashboard';
import { VillagePage } from './pages/Village';
import { AboutPage } from './pages/About';

function ShareRedirect() {
  const { code } = useParams();
  return <IncidentPage code={code} />;
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
startOutboxSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/masuk" element={<LoginPage />} />
          <Route path="/peringatan" element={<AlertsPage />} />
          <Route path="/desa-saya" element={<MyVillagesPage />} />
          <Route path="/kejadian/:id" element={<IncidentPage />} />
          <Route path="/kejadian/:id/cek" element={<VerifyPage />} />
          <Route path="/k/:code" element={<ShareRedirect />} />
          <Route path="/dasbor" element={<DashboardPage />} />
          <Route path="/desa/:id" element={<VillagePage />} />
          <Route path="/tentang" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
