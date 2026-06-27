import React, { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner, Image } from 'react-bootstrap';
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
      console.log('Loading profile image for user:', userId);
      
      // Always use cache busting for now to ensure we get the latest image
      const url = `/api/auth/profile-image/${userId}?t=${Date.now()}`;
      const token = localStorage.getItem('token');
      
      if (!token) {
        console.warn('No token found when loading profile image');
        setPreviewImage(defaultProfileImg);
        return;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.warn(`Failed to load profile image (${response.status}): ${response.statusText}`);
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
          console.log('Profile image cached successfully');
        } catch (storageError) {
          console.warn('Failed to cache profile image:', storageError);
        }
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error loading profile image:', error);
      setPreviewImage(defaultProfileImg);
    }
  };
  
  // Fetch user data on component mount
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const response = await authAPI.getProfile();
        console.log('Profile response:', response);
        
        // Check if we have data in the expected format
        const userData = response.data?.data || response.data;
        
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
        console.error('Error fetching profile:', err);
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
        console.log('Profile update: Image exists, will use formData');
        // Log image details for debugging
        console.log('Image upload:', {
          imageType: profileImage.type,
          imageSize: (profileImage.size / 1024).toFixed(2) + ' KB',
          imageName: profileImage.name
        });
        
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
        
      console.log('Profile update result:', response);
        
      // Only update token if server explicitly sends a new one
      if (response.data && response.data.token) {
        localStorage.setItem('token', response.data.token);
        console.log('Updated authentication token');
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
      console.error('Error updating profile:', err);
      setError(err.response?.data?.message || 'Error updating profile');
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
  );
};

export default Profile; 