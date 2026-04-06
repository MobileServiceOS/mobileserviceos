// src/app/Router.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useBusiness } from '../business/BusinessContext.jsx';
import { LoadingScreen } from '../components/index.jsx';
import { Login, Signup } from '../pages/Login.jsx';
import { Onboarding } from '../pages/Onboarding.jsx';
import { Dashboard } from '../pages/Dashboard.jsx';
import { AddJob } from '../pages/AddJob.jsx';
import { Jobs, JobDetails } from '../pages/Jobs.jsx';
import { Expenses } from '../pages/Expenses.jsx';
import { Payouts } from '../pages/Payouts.jsx';
import { Settings } from '../pages/Settings.jsx';
import { InvoiceView } from '../pages/Invoices.jsx';

function ProtectedRoute({ children }) {
  const { user, authReady }    = useAuth();
  const { business, bizLoaded } = useBusiness();

  if (!authReady || !bizLoaded) return <LoadingScreen/>;
  if (!user)     return <Navigate to="/login" replace/>;
  if (!business) return <Navigate to="/onboarding" replace/>;
  return children;
}

function AuthRoute({ children }) {
  const { user, authReady } = useAuth();
  if (!authReady) return <LoadingScreen/>;
  if (user) return <Navigate to="/dashboard" replace/>;
  return children;
}

export function AppRouter() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login"    element={<AuthRoute><Login/></AuthRoute>}/>
      <Route path="/signup"   element={<AuthRoute><Signup/></AuthRoute>}/>
      <Route path="/onboarding" element={<Onboarding/>}/>

      {/* Protected app routes */}
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard/></ProtectedRoute>}/>
      <Route path="/jobs"      element={<ProtectedRoute><Jobs/></ProtectedRoute>}/>
      <Route path="/jobs/new"  element={<ProtectedRoute><AddJob/></ProtectedRoute>}/>
      <Route path="/jobs/:id"  element={<ProtectedRoute><JobDetails/></ProtectedRoute>}/>
      <Route path="/jobs/:id/edit"    element={<ProtectedRoute><AddJob/></ProtectedRoute>}/>
      <Route path="/jobs/:jobId/invoice" element={<ProtectedRoute><InvoiceView/></ProtectedRoute>}/>
      <Route path="/expenses"  element={<ProtectedRoute><Expenses/></ProtectedRoute>}/>
      <Route path="/payouts"   element={<ProtectedRoute><Payouts/></ProtectedRoute>}/>
      <Route path="/settings"  element={<ProtectedRoute><Settings/></ProtectedRoute>}/>

      {/* Default */}
      <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
    </Routes>
  );
}
