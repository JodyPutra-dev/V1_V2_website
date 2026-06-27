import React, { useState } from 'react';
import { Container, Row, Col, Form, Button, Alert, Card } from 'react-bootstrap';
import { useNavigate, Link } from 'react-router-dom';
import { authAPI } from '../services/api';

const Register = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const response = await authAPI.register({
        name: formData.name,
        email: formData.email,
        password: formData.password
      });
      
      if (response.data && response.data.token) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        // Dispatch auth-change event to notify components that need to update
        window.dispatchEvent(new Event('auth-change'));
        
        navigate('/dashboard');
      } else {
        setError('Registration failed. Please try again.');
      }
    } catch (err) {
      setError(
        err.response?.data?.message || 
        'Registration failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = () => {
    if (!formData.password) return '';
    
    if (formData.password.length < 6) return 'Weak';
    if (formData.password.length < 10) return 'Medium';
    return 'Strong';
  };

  const getPasswordStrengthClass = () => {
    const strength = passwordStrength();
    if (strength === 'Weak') return 'danger';
    if (strength === 'Medium') return 'warning';
    if (strength === 'Strong') return 'success';
    return '';
  };

  return (
    <Container fluid className="page-transition">
      <Row className="justify-content-center align-items-center" style={{ minHeight: "80vh" }}>
        <Col xs={12} sm={10} md={8} lg={6} xl={5}>
          <Card className="shadow-lg border-0">
            <Card.Header className="text-center py-4">
              <h2 className="mb-0">Create Account</h2>
              <p className="text-muted mb-0">Join our healthcare platform</p>
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
              
              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-4">
                  <Form.Label>
                    <i className="fas fa-user me-2"></i>
                    Full Name
                  </Form.Label>
                  <Form.Control
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Enter your full name"
                    required
                    autoFocus
                    size="lg"
                  />
                </Form.Group>
                
                <Form.Group className="mb-4">
                  <Form.Label>
                    <i className="fas fa-envelope me-2"></i>
                    Email Address
                  </Form.Label>
                  <Form.Control
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="Enter your email address"
                    required
                    size="lg"
                  />
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>
                    <i className="fas fa-lock me-2"></i>
                    Password
                  </Form.Label>
                  <Form.Control
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Create a password"
                    required
                    size="lg"
                  />
                  
                  {formData.password && (
                    <div className="mt-2">
                      <div className="d-flex align-items-center">
                        <div className="me-2">Strength:</div>
                        <span className={`badge bg-${getPasswordStrengthClass()}`}>
                          {passwordStrength()}
                        </span>
                      </div>
                      <div className="progress mt-1" style={{ height: '5px' }}>
                        <div 
                          className={`progress-bar bg-${getPasswordStrengthClass()}`} 
                          style={{ 
                            width: formData.password.length < 6 ? '30%' : 
                                  formData.password.length < 10 ? '70%' : '100%' 
                          }}
                        ></div>
                      </div>
                      <Form.Text className="text-muted mt-1">
                        Password must be at least 6 characters long
                      </Form.Text>
                    </div>
                  )}
                </Form.Group>
                
                <Form.Group className="mb-4">
                  <Form.Label>
                    <i className="fas fa-lock me-2"></i>
                    Confirm Password
                  </Form.Label>
                  <Form.Control
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Confirm your password"
                    required
                    size="lg"
                    isInvalid={formData.confirmPassword && formData.password !== formData.confirmPassword}
                  />
                  {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                    <Form.Control.Feedback type="invalid">
                      Passwords do not match
                    </Form.Control.Feedback>
                  )}
                </Form.Group>
                
                <Form.Group className="mb-4">
                  <Form.Check
                    type="checkbox"
                    id="termsAgreement"
                    label={
                      <span>
                        I agree to the <a href="/terms" className="text-decoration-none">Terms of Service</a> and <a href="/privacy" className="text-decoration-none">Privacy Policy</a>
                      </span>
                    }
                    required
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
                      Creating Account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </Form>
            </Card.Body>
            
            <Card.Footer className="text-center py-3 bg-white">
              <p className="mb-0">
                Already have an account?{' '}
                <Link to="/login" className="text-decoration-none fw-bold">
                  Sign In
                </Link>
              </p>
            </Card.Footer>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default Register; 