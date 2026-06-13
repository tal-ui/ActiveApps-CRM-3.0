import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
import MonthlyDashboard from "./pages/MonthlyDashboard";
import SlackIntegrationPage from "./pages/settings/SlackIntegrationPage";
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
            <Route path="/time_entries" element={<TimeTrackingPage />} />
            <Route path="/settings/custom-fields" element={<CustomFieldsPage />} />
            <Route path="/settings/layouts" element={<LayoutBuilderPage />} />
            <Route path="/settings/slack" element={<SlackIntegrationPage />} />
            <Route path="/:object" element={<ListPage />} />
            <Route path="/:object/:id" element={<RecordPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
