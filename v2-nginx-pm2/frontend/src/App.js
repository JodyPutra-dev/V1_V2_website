import React, { useEffect, useState, useRef } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import config from './config';

// Page components
import Register from './pages/Register';
import Login from './pages/Login';
import NavBar from './components/Navbar';
import MLPrediction from './pages/MLPrediction';
import PredictionHistory from './pages/PredictionHistory';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import Profile from './pages/Profile';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import TestUpload from './pages/TestUpload';
import SimpleTest from './pages/SimpleTest';
import DebugPage from './pages/DebugPage';
import HealthTips from './pages/HealthTips';

// Auth protection component
import ProtectedRoute from './components/ProtectedRoute';

// Import colors
import { orangeTheme, blueTheme } from './colors';

// Check if user is admin
const isUserAdmin = () => {
  try {
    const token = localStorage.getItem('token');
    if (!token) return false;
    
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user && user.id && user.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

// Check if authentication is valid
const isAuthenticated = () => {
  try {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (!token || !userData) return false;
    
    const user = JSON.parse(userData);
    return !!(user && user.id && user.email);
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
};

function App() {
  // Add state to track authentication status
  const [authStatus, setAuthStatus] = useState({
    isAuthenticated: isAuthenticated(),
    isAdmin: isUserAdmin()
  });
  
  // Add a ref to track if we're already handling a redirect
  const isRedirecting = useRef(false);

  // Function to refresh auth status
  const refreshAuthStatus = () => {
    setAuthStatus({
      isAuthenticated: isAuthenticated(),
      isAdmin: isUserAdmin()
    });
  };

  // Set theme from config
  useEffect(() => {
    // Remove any existing theme classes
    document.body.classList.remove('theme-orange', 'theme-blue');
    // Add the theme class based on config
    document.body.classList.add(`theme-${config.colorTheme}`);
  }, []);

  // Apply theme colors based on config
  useEffect(() => {
    const theme = config.colorTheme === 'orange' ? orangeTheme : blueTheme;
    
    // Apply theme colors to CSS variables
    Object.entries(theme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value);
    });
  }, []);

  // Listen for changes to localStorage (login/logout)
  useEffect(() => {
    // Create a function to handle storage changes
    const handleStorageChange = () => {
      // Avoid unnecessary refresh if nothing actually changed
      const newIsAuth = isAuthenticated();
      const newIsAdmin = isUserAdmin();
      
      if (newIsAuth !== authStatus.isAuthenticated || 
          newIsAdmin !== authStatus.isAdmin) {
        refreshAuthStatus();
      }
    };

    // Add event listener for storage changes
    window.addEventListener('storage', handleStorageChange);

    // Reduce polling frequency from 10s to 30s to avoid excessive refreshes
    const intervalId = setInterval(() => {
      // Only check if we're not on the login page to avoid refresh loops
      if (window.location.pathname !== '/login') {
        handleStorageChange();
      }
    }, 30000);

    // Cleanup function
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(intervalId);
    };
  }, [authStatus.isAuthenticated, authStatus.isAdmin]);

  // Admin protected route component - with loading state
  const AdminRoute = ({ children }) => {
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    
    useEffect(() => {
      // First check if the user is authenticated at all
      if (!isAuthenticated()) {
        console.log('AdminRoute: Not authenticated, redirecting to login');
        setLoading(false);
        return;
      }
      
      // Then check if they're an admin
      if (isUserAdmin()) {
        console.log('AdminRoute: User is admin, granting access');
        setAuthorized(true);
      } else {
        console.log('AdminRoute: User is not admin, redirecting to dashboard');
      }
      
      setLoading(false);
    }, []);
    
    if (loading) {
      return <div className="text-center mt-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="mt-2">Verifying admin access...</p>
      </div>;
    }
    
    if (!isAuthenticated()) {
      return <Navigate to="/login" />;
    }
    
    return authorized ? children : <Navigate to="/dashboard" />;
  };
  
  // User protected route component - admins cannot access - with loading state
  const UserRoute = ({ children }) => {
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    
    useEffect(() => {
      // First check if the user is authenticated at all
      if (!isAuthenticated()) {
        console.log('UserRoute: Not authenticated, redirecting to login');
        setLoading(false);
        return;
      }
      
      // Then check if they're not an admin
      if (!isUserAdmin()) {
        console.log('UserRoute: User is not admin, granting access');
        setAuthorized(true);
      } else {
        console.log('UserRoute: User is admin, redirecting to admin dashboard');
      }
      
      setLoading(false);
    }, []);
    
    if (loading) {
      return <div className="text-center mt-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="mt-2">Verifying user access...</p>
      </div>;
    }
    
    if (!isAuthenticated()) {
      return <Navigate to="/login" />;
    }
    
    return authorized ? children : <Navigate to="/admin" />;
  };

  return (
    <div className="app-container">
      <NavBar key={`navbar-${authStatus.isAuthenticated}-${authStatus.isAdmin}`} />
      <div className="container mt-4">
        <Routes>
          {/* Public routes */}
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login onLoginSuccess={refreshAuthStatus} />} />
          <Route path="/test-upload" element={<TestUpload />} />
          <Route path="/simple-test" element={<SimpleTest />} />
          <Route path="/debug" element={<DebugPage />} />
          
          {/* Admin dashboard */}
          <Route path="/admin" element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          } />
          
          {/* Protected user routes - admins cannot access */}
          <Route path="/dashboard" element={
            <UserRoute>
              <Dashboard />
            </UserRoute>
          } />
          <Route path="/ml-prediction" element={
            <UserRoute>
              <MLPrediction />
            </UserRoute>
          } />
          <Route path="/prediction-history" element={
            <UserRoute>
              <PredictionHistory />
            </UserRoute>
          } />
          <Route path="/health-tips" element={
            <UserRoute>
              <HealthTips />
            </UserRoute>
          } />
          
          {/* Profile and change password routes - accessible to all authenticated users */}
          <Route path="/profile" element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } />
          <Route path="/change-password" element={
            <ProtectedRoute>
              <ChangePassword />
            </ProtectedRoute>
          } />
          
          {/* Root route - redirect based on authentication status */}
          <Route path="/" element={
            (() => {
              // Prevent redirect loops by checking the ref
              if (isRedirecting.current) {
                return <div className="text-center mt-5">Loading...</div>;
              }
              
              isRedirecting.current = true;
              
              // First check if the user is authenticated at all
              if (!isAuthenticated()) {
                console.log('Root route: User not authenticated, redirecting to login');
                setTimeout(() => { isRedirecting.current = false; }, 100);
                return <Navigate to="/login" replace />;
              }
              
              // Then check if they're an admin
              try {
                if (isUserAdmin()) {
                  console.log('Root route: User is admin, redirecting to admin dashboard');
                  setTimeout(() => { isRedirecting.current = false; }, 100);
                  return <Navigate to="/admin" replace />;
                } else {
                  console.log('Root route: User is not admin, redirecting to user dashboard');
                  setTimeout(() => { isRedirecting.current = false; }, 100);
                  return <Navigate to="/dashboard" replace />;
                }
              } catch (error) {
                console.error('Root route: Error checking user role:', error);
                setTimeout(() => { isRedirecting.current = false; }, 100);
                return <Navigate to="/login" replace />;
              }
            })()
          } />
          
          {/* Catch all route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App; 