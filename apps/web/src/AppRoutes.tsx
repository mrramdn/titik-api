// The app's screens by address, apart from main.tsx so a test can render them. An address the app does not know shows
// the not-found page there and is never rewritten (pages/NotFound.tsx says why).
import { Navigate, Route, Routes } from 'react-router';
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
import { NotFoundPage } from './pages/NotFound';
import { MAP_PATH } from './routes';

export function AppRoutes() {
  return (
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
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
