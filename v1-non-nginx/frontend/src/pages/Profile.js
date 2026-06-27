import React, { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner, Image, Modal } from 'react-bootstrap';
import { authAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';
import defaultProfileImg from '../images/default-profile.png';

const Profile = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [imageError, setImageError] = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const navigate = useNavigate();
  
  // Profile info form state
  const [profileInfo, setProfileInfo] = useState({
    name: '',
    email: '',
  });
  
  // Profile image state
  const [profileImage, setProfileImage] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const fileInputRef = useRef(null);
  
  // Function to load profile image
  const loadProfileImage = async (userId, cacheBuster = false) => {
    try {
      // Always use cache busting for now to ensure we get the latest image
      const url = `/api/auth/profile-image/${userId}?t=${Date.now()}`;
      const token = localStorage.getItem('token');
      
      if (!token) {
        setPreviewImage(defaultProfileImg);
        return;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        setPreviewImage(defaultProfileImg);
        return;
      }

      // Convert the response to a blob
      const blob = await response.blob();
      
      // Create a data URL from the blob
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result;
        setPreviewImage(base64data);
        
        // Cache the image in local storage
        try {
          localStorage.setItem(`profileImage_${userId}`, base64data);
          localStorage.setItem(`profileImage_${userId}_timestamp`, Date.now().toString());
        } catch (storageError) {
          // Storage error handling
        }
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      setPreviewImage(defaultProfileImg);
    }
  };
  
  // Fetch user data on component mount
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const response = await authAPI.getProfile();
        console.log('[TOKEN-TRACE] Initial fetch response structure:', Object.keys(response));
        console.log('[TOKEN-TRACE] response.data structure:', response.data ? Object.keys(response.data) : 'null');
        
        // Check if we have data in the expected format
        const userData = response.data?.data || response.data;
        console.log('[TOKEN-TRACE] Extracted userData:', userData ? Object.keys(userData) : 'null');
        console.log('[TOKEN-TRACE] userData.deviceToken:', userData?.deviceToken || 'NOT FOUND');
        
        if (!userData) {
          throw new Error('No user data received from server');
        }
        
        setUser(userData);
        setProfileInfo({
          name: userData.name || '',
          email: userData.email || '',
        });
        
        // Load profile image if user has one
        if (userData.id || userData._id) {
          const userId = userData.id || userData._id;
          // Clear any existing cache first
          localStorage.removeItem(`profileImage_${userId}`);
          localStorage.removeItem(`profileImage_${userId}_timestamp`);
          // Load the image with cache busting to ensure we get the latest version
          await loadProfileImage(userId, true);
        }
        
        // Check if user was redirected here to change password
        const passwordResetRequired = sessionStorage.getItem('passwordResetRequired');
        if (passwordResetRequired) {
          setError('Your password has been reset by an administrator. Please change your password to continue.');
          sessionStorage.removeItem('passwordResetRequired');
        }
      } catch (err) {
        setError('Error loading profile data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchUserProfile();
  }, []);
  
  // Reset image error state when preview image changes
  useEffect(() => {
    setImageError(false);
  }, [previewImage]);
  
  // Handle profile info change
  const handleProfileInfoChange = (e) => {
    const { name, value } = e.target;
    setProfileInfo({
      ...profileInfo,
      [name]: value,
    });
  };
  
  // Handle profile image change
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type and size
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
      return;
    }
    
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setError('Image size should be less than 10MB');
      return;
    }
    
    setProfileImage(file);
    
      // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewImage(reader.result);
    };
    reader.readAsDataURL(file);
    }
  };
  
  // Trigger file input click
  const handleImageClick = () => {
    fileInputRef.current.click();
  };
  
  // Handle profile info submit
  const handleProfileInfoSubmit = async (e) => {
    e.preventDefault();
    setUpdating(true);
    setError('');
    setSuccess('');
    
    try {
      let response;
      
      if (profileImage) {
        // Create FormData and append file
        const formData = new FormData();
        formData.append('profileImage', profileImage);
        if (profileInfo.name) {
          formData.append('name', profileInfo.name);
        }
        
        // Update profile with image
        response = await authAPI.updateProfileWithImage(formData);
      } else {
        // Update profile without image
        response = await authAPI.updateProfile(profileInfo);
      }
        
      // Only update token if server explicitly sends a new one
      if (response.data && response.data.token) {
        localStorage.setItem('token', response.data.token);
      }
      
      // Update user data in localStorage
      if (response.data && (response.data.user || response.data.data)) {
        const userData = response.data.user || response.data.data;
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const updatedUser = { ...currentUser, ...userData };
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
      
      setSuccess('Profile updated successfully');
      
      // Clear image cache and reload with cache busting
      if (profileImage && user?._id) {
        // Clear cached image from localStorage
        localStorage.removeItem(`profileImage_${user._id}`);
        localStorage.removeItem(`profileImage_${user._id}_timestamp`);
        
        // Force reload image with cache busting
        await loadProfileImage(user._id, true);
        
        // Reset profile image state
        setProfileImage(null);
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Error updating profile');
    } finally {
      setUpdating(false);
    }
  };
  
  // Handle device token regeneration
  const handleRegenerateToken = async () => {
    setUpdating(true);
    setError('');
    setSuccess('');
    
    try {
      const response = await authAPI.regenerateDeviceToken();
      
      // Extract token from nested response structure
      const newToken = response.data?.data?.deviceToken || response.data?.deviceToken;
      console.log('[TOKEN-REGEN] Extracted token:', newToken);
      
      // Update user state with new token
      if (newToken) {
        setUser(prev => ({
          ...prev,
          deviceToken: newToken
        }));
        
        // Update localStorage
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const updatedUser = { ...currentUser, deviceToken: newToken };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        
        setSuccess('Device token regenerated successfully! Update your IoT device.');
        
        // Refetch user profile to ensure UI consistency
        const updatedProfile = await authAPI.getProfile();
        const userData = updatedProfile.data?.data || updatedProfile.data;
        console.log('[TOKEN-REGEN] Refetch userData.deviceToken:', userData?.deviceToken);
        if (userData && userData.deviceToken) {
          setUser(userData);
        }
      }
      
      setShowTokenModal(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Error regenerating device token');
      setShowTokenModal(false);
    } finally {
      setUpdating(false);
    }
  };
  
  // Handle navigate to change password
  const navigateToChangePassword = () => {
    navigate('/change-password');
  };
  
  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3">Loading profile...</p>
      </Container>
    );
  }
  
  return (
    <>
    <Container className="py-5">
      <h1 className="mb-4">
        <i className="fas fa-user-circle me-2"></i>
        My Profile
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
      
      <Row>
        <Col lg={8} className="mb-4 mx-auto">
          <Card className="shadow-sm">
            <Card.Header className="bg-dark text-white">
              <h5 className="mb-0">
                <i className="fas fa-id-card me-2"></i>
                Profile Information
              </h5>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={handleProfileInfoSubmit}>
                <div className="text-center mb-4">
                  <div 
                    onClick={handleImageClick} 
                    style={{ 
                      cursor: 'pointer',
                      position: 'relative',
                      display: 'inline-block'
                    }}
                  >
                    {previewImage && !imageError ? (
                      <Image 
                        src={previewImage} 
                        roundedCircle 
                        style={{ 
                          width: '150px', 
                          height: '150px', 
                          objectFit: 'cover',
                          border: '3px solid #F97316'
                        }}
                        onError={(e) => {
                          e.target.onError = null; // Prevent infinite loops
                          setImageError(true); // Set error state
                          e.target.src = defaultProfileImg; // Use imported default image
                        }}
                      />
                    ) : (
                      <div 
                        style={{ 
                          width: '150px', 
                          height: '150px', 
                          borderRadius: '50%',
                          backgroundColor: '#f8f9fa',
                          border: '3px solid #F97316',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundImage: `url(${defaultProfileImg})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }}
                      >
                      </div>
                    )}
                    <div 
                      style={{ 
                        position: 'absolute',
                        bottom: '5px',
                        right: '5px',
                        backgroundColor: '#F97316',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }}
                    >
                      <i className="fas fa-camera text-white"></i>
                    </div>
                  </div>
                  <input
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleImageChange} 
                    accept="image/*"
                    style={{ display: 'none' }}
                  />
                </div>
                
                <Form.Group className="mb-3">
                  <Form.Label>
                    <i className="fas fa-user me-2"></i>
                    Nickname
                  </Form.Label>
                  <Form.Control
                    type="text"
                    name="name"
                    value={profileInfo.name}
                    onChange={handleProfileInfoChange}
                    placeholder="Enter your nickname"
                    required
                  />
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>
                    <i className="fas fa-envelope me-2"></i>
                    Email
                  </Form.Label>
                  <Form.Control
                    type="email"
                    value={profileInfo.email}
                    disabled
                    className="bg-light"
                  />
                  <Form.Text className="text-muted">
                    Email cannot be changed. Contact an administrator if you need to update it.
                  </Form.Text>
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>
                    <i className="fas fa-microchip me-2"></i>
                    IoT Device Token
                  </Form.Label>
                  <div className="d-flex gap-2">
                    <Form.Control
                      type="text"
                      value={user?.deviceToken || 'Not generated'}
                      disabled
                      className="bg-light"
                      style={{ fontFamily: "'Courier New', monospace", fontSize: '0.9rem' }}
                    />
                    <Button 
                      variant="outline-secondary"
                      size="sm"
                      onClick={async () => {
                        if (user?.deviceToken) {
                          try {
                            // Modern Clipboard API (works in HTTPS secure context)
                            if (navigator.clipboard && window.isSecureContext) {
                              await navigator.clipboard.writeText(user.deviceToken);
                              setSuccess('Device token copied to clipboard!');
                              setTimeout(() => setSuccess(''), 3000);
                            } else {
                              // Fallback for HTTP or older browsers
                              const textarea = document.createElement('textarea');
                              textarea.value = user.deviceToken;
                              textarea.style.position = 'fixed';
                              textarea.style.opacity = '0';
                              document.body.appendChild(textarea);
                              textarea.select();
                              document.execCommand('copy');
                              document.body.removeChild(textarea);
                              setSuccess('Device token copied to clipboard!');
                              setTimeout(() => setSuccess(''), 3000);
                            }
                          } catch (err) {
                            console.error('Copy failed:', err);
                            setError('Failed to copy token. Please select and copy manually.');
                          }
                        }
                      }}
                      disabled={!user?.deviceToken}
                      style={{ minWidth: '80px' }}
                    >
                      <i className="fas fa-copy me-1"></i>
                      Copy
                    </Button>
                  </div>
                  <Form.Text className="text-muted">
                    Use the Generate/Regenerate button below to create or update your device token.
                  </Form.Text>
                </Form.Group>
                
                <div className="mb-3">
                  <Button 
                    variant="warning"
                    size="sm"
                    onClick={() => setShowTokenModal(true)}
                    disabled={updating}
                  >
                    <i className="fas fa-sync-alt me-1"></i>
                    {user?.deviceToken ? 'Regenerate Token' : 'Generate Token'}
                  </Button>
                </div>
                
                <div className="d-grid gap-2">
                  <Button 
                    type="submit" 
                    disabled={updating}
                    style={{
                      backgroundColor: '#F97316',
                      borderColor: '#F97316',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = '#EA580C';
                      e.currentTarget.style.borderColor = '#EA580C';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = '#F97316';
                      e.currentTarget.style.borderColor = '#F97316';
                    }}
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
                        Save Changes
                      </>
                    )}
                  </Button>
                  
                  <Button 
                    variant="outline-secondary" 
                    onClick={navigateToChangePassword}
                    className="mt-2"
                  >
                    <i className="fas fa-key me-2"></i>
                    Change Password
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>

    {/* Token Regeneration Confirmation Modal */}
    <Modal show={showTokenModal} onHide={() => setShowTokenModal(false)} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="fas fa-exclamation-triangle me-2 text-warning"></i>
          Confirm Token Regeneration
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="mb-0">
          This will invalidate your current IoT device connection. Continue?
        </p>
        <div className="mt-3 p-2 bg-light rounded">
          <small className="text-muted">
            <i className="fas fa-info-circle me-1"></i>
            You will need to update your ESP8266 device with the new token after regeneration.
          </small>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowTokenModal(false)}>
          <i className="fas fa-times me-1"></i>
          Cancel
        </Button>
        <Button 
          variant="warning" 
          onClick={handleRegenerateToken}
          disabled={updating}
        >
          {updating ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-2" />
              Regenerating...
            </>
          ) : (
            <>
              <i className="fas fa-sync-alt me-1"></i>
              Confirm Regenerate
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
    </>
  );
};

export default Profile; 