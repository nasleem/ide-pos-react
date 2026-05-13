import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"; 
import IDempiereAuth from "./pages/IDempiereAuth";
import Dashboard from "./pages/Dashboard";
import BusinessPartner from "./pages/BusinessPartner"; // Import halaman partner
import BusinessPartnerDetail from "./pages/BusinessPartnerDetail"; 
import POSContainer from "./pages/POSContainer"; 
import Header from "./components/Header"; // Import Header
import Sidebar from "./components/Sidebar";

export default function App() {
  const [session, setSession] = useState(null);

  function handleLoginSuccess(sessionInfo) {
    setSession(sessionInfo);
  }

  function handleLogout() {
    setSession(null);
    localStorage.removeItem('token'); // Bersihkan token saat logout
  }

  return (
    <BrowserRouter>
      {!session ? (
        <Routes>
          <Route path="/" element={<IDempiereAuth onLoginSuccess={handleLoginSuccess} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      ) : (
        /* Gunakan class app-layout untuk Grid */
        <div className="app-layout">
          <Sidebar />
          
          {/* Kontainer baru untuk area kanan */}
          <div className="main-wrapper">
            <Header session={session} onLogout={handleLogout} />
            
            <main className="content">
              <Routes>
                <Route path="/dashboard" element={<Dashboard session={session} />} />
                <Route path="/business-partner" element={<BusinessPartner />} />
                <Route path="/sales-order" element={<POSContainer />} />
                <Route path="/bp/:id" element={<BusinessPartnerDetail />} />
                <Route path="/" element={<Navigate to="/dashboard" />} />
              </Routes>
            </main>
          </div>
        </div>
      )}
    </BrowserRouter>
  );
  
}
