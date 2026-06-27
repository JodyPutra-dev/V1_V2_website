import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { authAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';

const ChangePassword = () => {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  
  // Password form state
  const [passwordInfo, setPasswordInfo] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  
  // Password validation state
  const [passwordValidation, setPasswordValidation] = useState({
    length: false,
    capital: false,
    symbol: false,
  });
  
  // Check if user was redirected here to change password on component mount
  useEffect(() => {
    const passwordResetRequired = sessionStorage.getItem('passwordResetRequired');
    if (passwordResetRequired) {
      setError('Your password has been reset by an administrator. Please change your password to continue.');
      // Remove the flag from session storage
      sessionStorage.removeItem('passwordResetRequired');
    }
    
    // Focus on the password field
    document.getElementById('current-password-input')?.focus();
  }, []);
  
  // Handle password change
  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordInfo({
      ...passwordInfo,
      [name]: value,
    });
    
    // Validate password if it's the new password field
    if (name === 'newPassword') {
      validatePassword(value);
    }
  };
  
  // Password validation
  const validatePassword = (password) => {
    setPasswordValidation({
      length: password.length >= 8,
      capital: /[A-Z]/.test(password),
      symbol: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
    });
  };
  
  // Handle password submit
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    
    // Validate passwords match
    if (passwordInfo.newPassword !== passwordInfo.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    
    // Validate password meets requirements
    if (!passwordValidation.length || !passwordValidation.capital || !passwordValidation.symbol) {
      setError('Password does not meet requirements');
      return;
    }
    
    setUpdating(true);
    setError('');
    setSuccess('');
    
    try {
      // API call to update password using the correct endpoint
      await authAPI.changePassword({
        currentPassword: passwordInfo.currentPassword,
        newPassword: passwordInfo.newPassword
      });
      
      setSuccess('Password updated successfully');
      
      // Reset password fields
      setPasswordInfo({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      
      // Redirect back to profile page after 2 seconds
      setTimeout(() => {
        navigate('/profile');
      }, 2000);
      
    } catch (err) {
      console.error('Error updating password:', err);
      setError(err.response?.data?.message || 'Failed to update password. Current password may be incorrect.');
    } finally {
      setUpdating(false);
    }
  };
  
  // Navigate back to profile
  const handleCancel = () => {
    navigate('/profile');
  };
  
  return (
    <Container className="py-5">
      <Row className="justify-content-center">
        <Col lg={6} md={8}>
          <h1 className="mb-4">
            <i className="fas fa-key me-2"></i>
            Change Password
          </h1>
          
          {error && (
            <Alert variant="danger" dismissible onClose={() => setError('')}>
              <i className="fas fa-exclamation-circle me-2"></i>
              {error}
            </Alert>
          )}
          
          {success && (
            <Alert variant="success" dismissible onClose={() => setSuccess('')}>
              <i className="fas fa-check-circle me-2"></i>
              {success}
            </Alert>
          )}
          
          <Card className="shadow-sm">
            <Card.Header className="bg-dark text-white">
              <h5 className="mb-0">
                <i className="fas fa-lock me-2"></i>
                Password Settings
              </h5>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={handlePasswordSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Current Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="currentPassword"
                    id="current-password-input"
                    value={passwordInfo.currentPassword}
                    onChange={handlePasswordChange}
                    required
                  />
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>New Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="newPassword"
                    value={passwordInfo.newPassword}
                    onChange={handlePasswordChange}
                    required
                  />
                </Form.Group>
                
                <Form.Group className="mb-4">
                  <Form.Label>Confirm New Password</Form.Label>
                  <Form.Control
                    type="password"
                    name="confirmPassword"
                    value={passwordInfo.confirmPassword}
                    onChange={handlePasswordChange}
                    required
                  />
                </Form.Group>
                
                <div className="password-requirements mb-4">
                  <p className="mb-2 fw-bold small">Password Requirements:</p>
                  <ul className="list-unstyled">
                    <li className={`small ${passwordValidation.length ? 'text-success' : 'text-muted'}`}>
                      <i className={`fas ${passwordValidation.length ? 'fa-check-circle' : 'fa-circle'} me-2`}></i>
                      At least 8 characters
                    </li>
                    <li className={`small ${passwordValidation.capital ? 'text-success' : 'text-muted'}`}>
                      <i className={`fas ${passwordValidation.capital ? 'fa-check-circle' : 'fa-circle'} me-2`}></i>
                      At least one capital letter
                    </li>
                    <li className={`small ${passwordValidation.symbol ? 'text-success' : 'text-muted'}`}>
                      <i className={`fas ${passwordValidation.symbol ? 'fa-check-circle' : 'fa-circle'} me-2`}></i>
                      At least one symbol
                    </li>
                  </ul>
                </div>
                
                <div className="d-flex gap-3">
                  <Button 
                    variant="primary" 
                    type="submit" 
                    className="flex-grow-1" 
                    disabled={updating || !passwordValidation.length || !passwordValidation.capital || !passwordValidation.symbol}
                  >
                    {updating ? (
                      <>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          role="status"
                          aria-hidden="true"
                          className="me-2"
                        />
                        Updating...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-save me-2"></i>
                        Update Password
                      </>
                    )}
                  </Button>
                  
                  <Button 
                    variant="secondary" 
                    onClick={handleCancel}
                    className="flex-grow-1"
                  >
                    <i className="fas fa-arrow-left me-2"></i>
                    Back to Profile
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ChangePassword; 