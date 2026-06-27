import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check authentication status
    const checkAuth = () => {
      const token = localStorage.getItem('token');
      const userData = localStorage.getItem('user');
      
      if (!token) {
        console.log('No token found - not authenticated');
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }
      
      try {
        // Verify user data is valid JSON
        if (!userData) {
          console.log('No user data found - not authenticated');
          localStorage.removeItem('token'); // Clean up orphaned token
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }
        
        const parsedUser = JSON.parse(userData);
        if (!parsedUser || !parsedUser.id) {
          console.log('Invalid user data - not authenticated');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setIsAuthenticated(false);
          setLoading(false);
          return;
        }
        
        // User is authenticated
        setIsAuthenticated(true);
        setLoading(false);
      } catch (error) {
        console.error('Error parsing user data:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setIsAuthenticated(false);
        setLoading(false);
      }
    };
    
    checkAuth();
  }, []);
  
  if (loading) {
    // Optional: show a loading spinner here
    return <div>Loading...</div>;
  }
  
  if (!isAuthenticated) {
    // Redirect to login if not authenticated
    return <Navigate to="/login" />;
  }
  
  // If authenticated, render the children components
  return children;
};

export default ProtectedRoute; 