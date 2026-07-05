import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ListPage from "./pages/ListPage";
import RecordPage from "./pages/RecordPage";
import TimeTrackingPage from "./pages/TimeTrackingPage";
import CustomFieldsPage from "./pages/settings/CustomFieldsPage";
import LayoutBuilderPage from "./pages/settings/LayoutBuilderPage";
import FinancialDashboard from "./pages/FinancialDashboard";
import PipelinePage from "./pages/PipelinePage";
import TaskBoardPage from "./pages/TaskBoardPage";
import MonthlyDashboard from "./pages/MonthlyDashboard";
import CurrencyCalculator from "./pages/CurrencyCalculator";
import SlackIntegrationPage from "./pages/settings/SlackIntegrationPage";
import MaintenancePage from "./pages/settings/MaintenancePage";
import UsersRolesPage from "./pages/settings/UsersRolesPage";
import AuditLogPage from "./pages/settings/AuditLogPage";
import WorkspaceSettingsPage from "./pages/settings/WorkspaceSettingsPage";
import AutomationsPage from "./pages/settings/AutomationsPage";
import { Spinner } from "./components/ui";

function Protected() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Layout />;
}

function RequireAdmin() {
  const { session, profile, isAdmin, loading } = useAuth();
  // profile is null only while its fetch is in flight (see auth.tsx invariant)
  if (loading || (session && !profile)) return <Spinner />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/financial" element={<FinancialDashboard />} />
            <Route path="/monthly" element={<MonthlyDashboard />} />
            <Route path="/currency" element={<CurrencyCalculator />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/tasks/board" element={<TaskBoardPage />} />
            <Route path="/time_entries" element={<TimeTrackingPage />} />
            <Route path="/settings/custom-fields" element={<CustomFieldsPage />} />
            <Route path="/settings/layouts" element={<LayoutBuilderPage />} />
            <Route path="/settings/slack" element={<SlackIntegrationPage />} />
            <Route element={<RequireAdmin />}>
              <Route path="/settings/maintenance" element={<MaintenancePage />} />
              <Route path="/settings/users" element={<UsersRolesPage />} />
              <Route path="/settings/audit" element={<AuditLogPage />} />
              <Route path="/settings/workspace" element={<WorkspaceSettingsPage />} />
              <Route path="/settings/automations" element={<AutomationsPage />} />
            </Route>
            <Route path="/:object" element={<ListPage />} />
            <Route path="/:object/:id" element={<RecordPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
