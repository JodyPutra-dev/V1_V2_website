import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Form, Button, Alert, Container, Row, Col } from 'react-bootstrap';
import { authAPI, debugAPI } from '../services/api';


const Login = ({ onLoginSuccess }) => {
  const [formData, setFormData] = useState({
    email: 'admin@example.com',
    password: 'admin123',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Check connection and protocol on load
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // Test if we can connect to the API and determine the working protocol
        const httpResult = await debugAPI.testHttp();
        if (httpResult.status === 200) {
          // Connection successful - no need to log
        }
      } catch (err) {
        // HTTP test failed - silent error
      }

      try {
        const httpsResult = await debugAPI.testHttps();
        if (httpsResult.status === 200) {
          // Connection successful - no need to log
        }
      } catch (err) {
        // HTTPS test failed - silent error
      }
    };

    // Check for existing login
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
      try {
        const userData = JSON.parse(user);
        if (userData && userData.id) {
          // Already logged in - navigate without console logs
          navigate(userData.role === 'admin' ? '/admin' : '/dashboard');
        }
      } catch (e) {
        // Silent error handling
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Continue with connection check
        checkConnection();
      }
    } else {
      checkConnection();
    }
  }, [navigate]);

  const { email, password } = formData;

  const onChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Removed console.log for login attempt
      // Removed console.log for API URL
      
      const res = await authAPI.login({ email, password });
      // Removed console.log for login success
      
      if (!res.data || !res.data.token) {
        throw new Error('Invalid response: Missing token');
      }
      
      // Store token and user data securely
      localStorage.setItem('token', res.data.token);
      
      // Create user object with consistent property names
      const userData = {
        id: res.data.user?._id || res.data.user?.id || res.data._id || res.data.id, 
        name: res.data.user?.name || res.data.name,
        email: res.data.user?.email || res.data.email,
        role: res.data.user?.role || res.data.role,
        passwordResetRequired: res.data.user?.passwordResetRequired || res.data.passwordResetRequired
      };
      
      localStorage.setItem('user', JSON.stringify(userData));

      // Notify parent component about successful login
      if (onLoginSuccess) {
        onLoginSuccess();
      }
      
      // Create a custom event to manually trigger a storage change
      window.dispatchEvent(new Event('storage'));
      
      // If password reset is required, redirect to change password page instead
      if (userData.passwordResetRequired) {
        sessionStorage.setItem('passwordResetRequired', 'true');
        navigate('/change-password');
      } else {
        // Normal login flow
        navigate(userData.role === 'admin' ? '/admin' : '/dashboard');
      }
    } catch (error) {
      // Replace console logs with silent handling - errors are shown to user via setError below
      
      // Handle specific error scenarios with user-friendly messages
      if (error.message === 'Invalid response: Missing token') {
        setError('Login failed: Server response did not include a valid token. Please try using the Direct Login button below.');
      } else if (error.message === 'Invalid credentials' || 
                (error.response && error.response.status === 401)) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (error.message && error.message.includes('Password incorrect')) {
        setError('The password you entered is incorrect. Please try again.');
      } else if (error.message && error.message.includes('User service returned error: 401')) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (error.message && (
          error.message.includes('Mixed Content') ||
          error.message.includes('plain HTTP request was sent to HTTPS') ||
          error.message.includes('certificate') ||
          error.message.includes('SSL')
      )) {
        setError('Connection security error detected. Please try Direct HTTP Login below.');
      } else if (error.response && error.response.status === 500) {
        // For 500 errors, provide specific guidance
        setError(
          <div>
            Server Error (500). This could be due to a database issue or missing user accounts.<br/>
            <ul className="mt-2 mb-0">
              <li>Check if the database is running</li>
              <li>Try using the default credentials: admin@example.com / admin123</li>
              <li>Try the <a href="/debug" className="alert-link">Debug Page</a> to create an admin user</li>
            </ul>
          </div>
        );
      } else if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      } else {
        setError(`Login failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Direct HTTP login handler
  const handleDirectLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      // Removed console.log for direct HTTP login
      const res = await authAPI.directLogin({ 
        email: formData.email || 'admin@example.com', 
        password: formData.password || 'admin123' 
      });
      
      // Check if we got a successful response with a token
      if (!res.data || !res.data.success || !res.data.token) {
        throw new Error(res.data?.message || 'Invalid response from server');
      }
      
      // Removed console.log for successful login
      
      // Store token and user data securely
      localStorage.setItem('token', res.data.token);
      
      // Create user object with consistent property names
      const userData = {
        id: res.data.user?._id || res.data.user?.id || res.data._id || res.data.id, 
        name: res.data.user?.name || res.data.name,
        email: res.data.user?.email || res.data.email,
        role: res.data.user?.role || res.data.role
      };
      
      localStorage.setItem('user', JSON.stringify(userData));
      
      // Notify parent component about successful login
      if (onLoginSuccess) {
        onLoginSuccess();
      }
      
      // Create a custom event to manually trigger a storage change
      window.dispatchEvent(new Event('storage'));
      
      navigate(userData.role === 'admin' ? '/admin' : '/dashboard');
    } catch (error) {
      // Silent error handling - errors are shown to user via setError below
      
      if (error.response && error.response.status === 401) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (error.message && error.message.includes('User service returned error: 401')) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      } else if (error.response && error.response.status === 500) {
        setError('Server error. The database may be unavailable or there might be connection issues.');
      } else {
        setError(`Direct login failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container fluid className="page-transition">
      <Row className="justify-content-center align-items-center" style={{ minHeight: "80vh" }}>
        <Col xs={12} sm={10} md={8} lg={6} xl={5}>
          <Card className="shadow-lg border-0">
            <Card.Header className="text-center py-4">
              <h2 className="mb-0">Welcome Back</h2>
              <p className="text-muted mb-0">Sign in to your account</p>
            </Card.Header>
            <Card.Body className="px-4 py-5">
              {error && (
                <Alert 
                  variant="danger" 
                  className="mb-4 text-center fade-in"
                  dismissible
                  onClose={() => setError('')}
                >
                  <i className="fas fa-exclamation-circle me-2"></i>
                  {error}
                </Alert>
              )}
              
              <Form onSubmit={onSubmit}>
                <Form.Group className="mb-4">
                  <Form.Label>
                    <i className="fas fa-envelope me-2"></i>
                    Email Address
                  </Form.Label>
                  <Form.Control
                    type="email"
                    name="email"
                    value={email}
                    onChange={onChange}
                    placeholder="Enter your email"
                    required
                    autoFocus
                    size="lg"
                  />
                </Form.Group>
                
                <Form.Group className="mb-4">
                  <Form.Label className="d-flex justify-content-between align-items-center">
                    <div>
                      <i className="fas fa-lock me-2"></i>
                      Password
                    </div>
                    <Link 
                      to="/forgot-password" 
                      className="text-decoration-none small"
                    >
                      Forgot Password?
                    </Link>
                  </Form.Label>
                  <Form.Control
                    type="password"
                    name="password"
                    value={password}
                    onChange={onChange}
                    placeholder="Enter your password"
                    required
                    size="lg"
                  />
                  <Form.Text className="text-muted">
                    Default credentials: admin@example.com / admin123
                  </Form.Text>
                </Form.Group>
                
                <Form.Group className="mb-4">
                  <Form.Check
                    type="checkbox"
                    id="rememberMe"
                    label="Remember me"
                  />
                </Form.Group>
                
                <Button
                  variant="primary"
                  type="submit"
                  className="w-100 py-2"
                  size="lg"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Signing in...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </Form>
            </Card.Body>
            <Card.Footer className="text-center py-3 bg-white">
              <p className="mb-0">
                Don't have an account?{' '}
                <Link to="/register" className="text-decoration-none fw-bold">
                  Create Account
                </Link>
              </p>
              <div className="mt-2">
                <small>
                  Having trouble logging in?{' '}
                  <Link to="/debug" className="text-decoration-none text-muted">
                    Try Debug Mode
                  </Link>
                  {' or '}
                  <Button 
                    variant="link"
                    className="p-0 text-decoration-none text-primary"
                    onClick={handleDirectLogin}
                    disabled={loading}
                  >
                    Direct HTTP Login
                  </Button>
                </small>
              </div>
            </Card.Footer>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default Login; 