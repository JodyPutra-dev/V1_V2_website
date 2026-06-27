import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap';
import './Navbar.css';

const NavBar = () => {
  const [expanded, setExpanded] = useState(false);
  const [isAuth, setIsAuth] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  
  // Check auth status whenever component mounts or receives new props
  useEffect(() => {
    const checkAuth = () => {
      try {
        const token = localStorage.getItem('token');
        const userData = JSON.parse(localStorage.getItem('user') || '{}');
        
        if (token && userData && userData.id) {
          setIsAuth(true);
          setUser(userData);
          setIsAdmin(userData.role === 'admin');
        } else {
          setIsAuth(false);
          setUser(null);
          setIsAdmin(false);
        }
      } catch (error) {
        setIsAuth(false);
        setUser(null);
        setIsAdmin(false);
      }
    };
    
    // Check auth immediately
    checkAuth();
    
    // Set up event listener for localStorage changes
    const handleStorageChange = () => {
      checkAuth();
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Clean up event listener on unmount
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [location.pathname]); // Re-run when path changes to ensure UI updates

  const handleLogout = () => {
    // Clear local storage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Update component state
    setIsAuth(false);
    setUser(null);
    setIsAdmin(false);
    setExpanded(false);
    
    // Dispatch a storage event to notify other components
    window.dispatchEvent(new Event('storage'));
    
    // Use React Router navigation instead of window.location
    navigate('/login', { replace: true });
  };
  
  const closeNavbar = () => setExpanded(false);
  
  const isActive = (path) => {
    return location.pathname === path ? 'active' : '';
  };
  
  return (
    <Navbar 
      bg="primary" 
      variant="dark" 
      expand="lg" 
      className="sticky-top"
      expanded={expanded}
      onToggle={setExpanded}
    >
      <Container>
        <Navbar.Brand as={Link} to="/" className="d-flex align-items-center" onClick={closeNavbar}>
          <i className="fas fa-flask me-2"></i>
          <span>Kidney Health Analysis</span>
        </Navbar.Brand>
        
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto">
            {isAuth ? (
              <>
                {isAdmin ? (
                  // Admin-only navigation links
                  <Nav.Link as={Link} to="/admin" className="me-2" onClick={closeNavbar}>
                    <i className="fas fa-user-shield me-1"></i>
                    Admin Dashboard
                  </Nav.Link>
                ) : (
                  // Regular user navigation links
                  <>
                    <Nav.Link as={Link} to="/dashboard" className="me-2" onClick={closeNavbar}>
                      <i className="fas fa-tachometer-alt me-1"></i>
                      Dashboard
                    </Nav.Link>
                    
                    <Nav.Link as={Link} to="/ml-prediction" className="me-2" onClick={closeNavbar}>
                      <i className="fas fa-vial me-1"></i>
                      Prediction
                    </Nav.Link>
                    
                    <Nav.Link as={Link} to="/prediction-history" className="me-2" onClick={closeNavbar}>
                      <i className="fas fa-history me-1"></i>
                      History
                    </Nav.Link>
                  </>
                )}
                
                <NavDropdown 
                  title={
                    <span>
                      <i className="fas fa-user-circle me-1"></i>
                      {user ? user.name : 'Account'}
                      {isAdmin && <span className="admin-badge ms-1">Admin</span>}
                    </span>
                  } 
                  id="basic-nav-dropdown"
                >
                  {!isAdmin && (
                    <NavDropdown.Item as={Link} to="/profile" onClick={closeNavbar}>
                      <i className="fas fa-id-card me-2"></i>
                      Profile
                    </NavDropdown.Item>
                  )}
                  
                  <NavDropdown.Divider />
                  
                  <NavDropdown.Item onClick={handleLogout}>
                    <i className="fas fa-sign-out-alt me-2"></i>
                    Logout
                  </NavDropdown.Item>
                </NavDropdown>
              </>
            ) : (
              <>
                <Nav.Link 
                  as={Link} 
                  to="/login" 
                  className={isActive('/login')} 
                  onClick={closeNavbar}
                >
                  <i className="fas fa-sign-in-alt me-1"></i> Login
                </Nav.Link>
                <Nav.Link 
                  as={Link} 
                  to="/register" 
                  className={isActive('/register')} 
                  onClick={closeNavbar}
                >
                  <i className="fas fa-user-plus me-1"></i> Register
                </Nav.Link>
              </>
            )}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default NavBar; 