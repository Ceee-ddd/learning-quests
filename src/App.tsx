import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Join from "./pages/Join.tsx";
import Play from "./pages/Play.tsx";
import Complete from "./pages/Complete.tsx";
import TeacherLogin from "./pages/TeacherLogin.tsx";
import TeacherDashboard from "./pages/TeacherDashboard.tsx";
import TeacherSession from "./pages/TeacherSession.tsx";
import TeacherResetPassword from "./pages/TeacherResetPassword.tsx";
import ScanRedirect from "./pages/ScanRedirect.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/join/:sessionId" element={<Join />} />
          <Route path="/play/:groupId" element={<Play />} />
          <Route path="/play/:groupId/scan" element={<Play />} />
          <Route path="/session/:sessionId/scan" element={<ScanRedirect />} />
          <Route path="/complete/:groupId" element={<Complete />} />
          <Route path="/teacher/login" element={<TeacherLogin />} />
          <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
          <Route path="/teacher/session/:sessionId" element={<TeacherSession />} />
          <Route path="/teacher/reset-password" element={<TeacherResetPassword />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;