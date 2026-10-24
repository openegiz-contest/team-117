import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from './components/AppLayout'
import { CommandCenter } from './pages/CommandCenter'
import { PatchedEvidencePage, PatchedOperationalPage } from './pages/PatchedDashboardRoutes'

export function App() {
  return <Routes><Route element={<AppLayout />}><Route index element={<CommandCenter />} /><Route path="twins" element={<PatchedOperationalPage view="twin" />} /><Route path="scenarios" element={<PatchedOperationalPage view="scenario" />} /><Route path="energy" element={<PatchedOperationalPage view="energy" />} /><Route path="evidence" element={<PatchedEvidencePage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes>
}
