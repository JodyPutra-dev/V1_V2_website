import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Button, Alert, Container, Spinner, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { predictionAPI } from '../services/api';

const Dashboard = () => {
  const [userProfile, setUserProfile] = useState(null);
  const [predictionStats, setPredictionStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileImage, setProfileImage] = useState(null);

  // Process prediction data from API response
  const processPredictionData = (response) => {
    let predictions = [];
    
    // Handle different response formats
    if (response.data && response.data.success === true && Array.isArray(response.data.data)) {
      // New format with { success, data: [] }
      predictions = response.data.data;
    } else if (response.data && Array.isArray(response.data)) {
      // Old format with direct array
      predictions = response.data;
    } else if (response.data && response.data.predictions && Array.isArray(response.data.predictions)) {
      // Format with { predictions: [] }
      predictions = response.data.predictions;
    } else if (response.data && response.data._id) {
      // Single prediction object
      predictions = [response.data];
    } else if (response.data && response.data.data && !Array.isArray(response.data.data) && typeof response.data.data === 'object') {
      // Format with { data: {} } (single object)
      predictions = [response.data.data];
    } else {
      console.warn('Unexpected response format:', response);
      predictions = [];
    }
    
    // Filter out any invalid entries
    return predictions.filter(item => item && typeof item === 'object');
  };

  // Process stats data from API response
  const processStatsData = (response) => {
    console.log('Processing stats data:', response);
    
    // Set fallback default values
    let stats = {
      totalPredictions: 0,
      normal: 0,
      abnormal: 0,
      latest: null
    };
    
    // Handle the actual backend response format
    if (response.data && response.data.success === true && response.data.data) {
      const backendData = response.data.data;
      stats = {
        totalPredictions: backendData.totalCount || 0,
        normal: backendData.normalCount || 0,
        abnormal: backendData.abnormalCount || 0,
        latest: backendData.recentPredictions && backendData.recentPredictions.length > 0 
          ? backendData.recentPredictions[0] 
          : null
      };
    } else if (response.data && typeof response.data === 'object') {
      // Handle direct stats properties (fallback for other formats)
      stats = {
        totalPredictions: response.data.totalCount || response.data.totalPredictions || 0,
        normal: response.data.normalCount || response.data.normal || 0,
        abnormal: response.data.abnormalCount || response.data.abnormal || 0,
        latest: response.data.recentPredictions && response.data.recentPredictions.length > 0 
          ? response.data.recentPredictions[0]
          : response.data.latest || null
      };
    }
    
    console.log('Processed stats:', stats);
    return stats;
  };

  // Function to load profile image
  const loadProfileImage = async (userId) => {
    try {
      const url = `/api/auth/profile-image/${userId}?t=${Date.now()}`;
      const token = localStorage.getItem('token');
      
      if (!token) {
        console.warn('No token found when loading profile image');
        return null;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.warn(`Failed to load profile image (${response.status}): ${response.statusText}`);
        return null;
      }

      // Convert the response to a blob
      const blob = await response.blob();
      
      // Create a data URL from the blob
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error loading profile image:', error);
      return null;
    }
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      setError('');
      
      try {
        // Get current user from localStorage
        const userString = localStorage.getItem('user');
        if (userString) {
          const userData = JSON.parse(userString);
          setUserProfile(userData);
          
          // Load profile image if user has one
          if (userData.id || userData._id) {
            const userId = userData.id || userData._id;
            const imageData = await loadProfileImage(userId);
            setProfileImage(imageData);
          }
        }

        // Fetch prediction stats
        try {
          console.log('Fetching prediction stats...');
          const statsResponse = await predictionAPI.getStats();
          console.log('Stats API response:', statsResponse);
          const stats = processStatsData(statsResponse);
          
          // Debug: Log full API response and parameter structure
          if (stats.latest && stats.latest.parameters) {
            console.log('[DASHBOARD] Raw statsResponse.data:', statsResponse.data);
            console.log('[DASHBOARD] Processed stats.latest:', stats.latest);
            console.log('[DASHBOARD] Parameter keys:', Object.keys(stats.latest.parameters));
            console.log('[DASHBOARD] Full parameters object:', stats.latest.parameters);
            console.log('[DASHBOARD] specificGravity value:', stats.latest.parameters.specificGravity);
            console.log('[DASHBOARD] specificgravity (lowercase) value:', stats.latest.parameters.specificgravity);
            console.log('[DASHBOARD] turbidityNTU value:', stats.latest.parameters.turbidityNTU);
            console.log('[DASHBOARD] turbidityntu (lowercase) value:', stats.latest.parameters.turbidityntu);
            console.log('[DASHBOARD-DEBUG] Raw parameters JSON:', JSON.stringify(stats.latest.parameters, null, 2));
            console.log('[DASHBOARD-DEBUG] Check if nested:', stats.latest.parameters?.parameters);
          }
          
          setPredictionStats(stats);
        } catch (statsError) {
          console.error('Error fetching stats:', statsError);
          // Set default stats so the UI doesn't break
          setPredictionStats({
            totalPredictions: 0,
            normal: 0,
            abnormal: 0,
            latest: null
          });
        }

        // Fetch recent predictions for additional context
        try {
          console.log('Fetching recent predictions...');
          const predictionsResponse = await predictionAPI.getHistory();
          console.log('History API response:', predictionsResponse);
          const predictions = processPredictionData(predictionsResponse);
          
          // If we don't have a latest prediction from stats, use the first from history
          if (!predictionStats?.latest && predictions.length > 0) {
            setPredictionStats(prev => ({
              ...prev,
              latest: predictions[0]
            }));
          }
        } catch (historyError) {
          console.error('Error fetching prediction history:', historyError);
          // This is non-critical, so we don't need to show an error
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        // Don't show an error to the user, just log it
        // This keeps the UI from showing error messages
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="text-center p-5 d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '70vh' }}>
        <Spinner animation="border" style={{ width: '3rem', height: '3rem', color: '#F97316' }} />
        <p className="mt-3" style={{ color: '#F97316' }}>Loading your dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Container className="py-5">
        <Alert 
          variant="danger" 
          className="text-center shadow-sm"
          dismissible
          onClose={() => setError('')}
        >
          <i className="fas fa-exclamation-triangle me-2"></i>
          {error}
        </Alert>
      </Container>
    );
  }

  // Calculate health status color based on abnormal predictions percentage
  const getHealthStatusColor = () => {
    if (!predictionStats || predictionStats.totalPredictions === 0) return 'info';
    
    const abnormalPercentage = (predictionStats.abnormal / predictionStats.totalPredictions) * 100;
    
    if (abnormalPercentage >= 60) return 'danger';
    if (abnormalPercentage >= 30) return 'warning';
    return 'success';
  };

  // Map status colors to our new palette
  const statusColorMap = {
    success: '#22C55E', // Green 500
    warning: '#F59E0B', // Amber 500
    danger: '#F97316',  // Orange 500
    info: '#3B82F6'     // Blue 500
  };

  // Get color for health status
  const getHealthStatusHexColor = () => {
    const status = getHealthStatusColor();
    return statusColorMap[status] || statusColorMap.info;
  };

  return (
    <Container className="py-4 page-transition">
      <Row className="mb-4 align-items-center">
        <Col md={8}>
          <h1 className="mb-2 display-5 fw-bold" style={{ color: '#F97316' }}>
            <i className="fas fa-tachometer-alt me-2"></i>
            Dashboard
          </h1>
          {userProfile && (
            <h5 className="text-muted">
              Welcome back, <span className="fw-bold">{userProfile.name}</span>
            </h5>
          )}
        </Col>
        <Col md={4} className="text-md-end mt-3 mt-md-0">
          <Link to="/ml-prediction">
            <Button 
              variant="primary" 
              size="lg" 
              className="shadow-sm"
              style={{ 
                backgroundColor: '#F97316', 
                borderColor: '#F97316',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#E86D10';
                e.currentTarget.style.borderColor = '#E86D10';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#F97316';
                e.currentTarget.style.borderColor = '#F97316';
              }}
            >
              <i className="fas fa-plus-circle me-2"></i>
              New Prediction
            </Button>
          </Link>
        </Col>
      </Row>
      
      <Row className="mb-4">
        <Col lg={4} md={6} sm={12} className="mb-4 mb-lg-0">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Body className="d-flex flex-column">
              <div className="d-flex align-items-center mb-3">
                <div className={`me-3 ${!profileImage ? 'rounded-circle p-3' : ''}`} style={{ 
                  backgroundColor: !profileImage ? 'rgba(249, 115, 22, 0.1)' : 'transparent',
                  width: profileImage ? '48px' : '64px',
                  height: profileImage ? '48px' : '64px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  border: profileImage ? '2px solid #F97316' : 'none',
                  borderRadius: '50%'
                }}>
                  {profileImage ? (
                    <img 
                      src={profileImage}
                      alt="Profile"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        borderRadius: '50%'
                      }}
                      onError={(e) => {
                        e.target.onError = null;
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                      }}
                    />
                  ) : (
                  <i className="fas fa-user-circle fa-2x" style={{ color: '#F97316' }}></i>
                  )}
                </div>
                <div>
                  <h6 className="text-muted mb-0">User Profile</h6>
                  <h4 className="mb-0">{userProfile?.name || 'User'}</h4>
                </div>
              </div>
              <div className="border-top pt-3">
                <p className="mb-1">
                  <i className="fas fa-envelope text-muted me-2"></i>
                  {userProfile?.email || 'email@example.com'}
                </p>
                <p className="mb-1">
                  <i className="fas fa-calendar-check text-muted me-2"></i>
                  Member since: {userProfile?.createdAt 
                    ? new Date(userProfile.createdAt).toLocaleDateString() 
                    : 'N/A'}
                </p>
                <p className="mb-0">
                  <i className="fas fa-user-shield text-muted me-2"></i>
                  Role: {userProfile?.role === 'admin' 
                    ? <span className="badge" style={{ backgroundColor: '#F97316' }}>Administrator</span> 
                    : <span className="badge bg-secondary">User</span>}
                </p>
              </div>
              <div className="mt-auto pt-3">
                <Link to="/profile" className="btn btn-outline-primary w-100" style={{ color: '#F97316', borderColor: '#F97316', transition: 'all 0.3s ease' }} 
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#F97316';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#F97316';
                  }}>
                  <i className="fas fa-id-card me-2"></i>
                  View Profile
                </Link>
              </div>
            </Card.Body>
          </Card>
        </Col>
        
        <Col lg={4} md={6} sm={12} className="mb-4 mb-lg-0">
          <Card className="h-100 border-0 shadow-sm">
            <Card.Body className="text-center">
              <div className="mb-4">
                <h5 className="text-muted">Kidney Health Analysis</h5>
                <div className="display-1 fw-bold mt-3 mb-0" style={{ color: '#F97316' }}>
                  {predictionStats?.totalPredictions || 0}
                </div>
                <p className="text-muted mb-4">Total Predictions</p>
                
                <div className="d-inline-block p-4 rounded-circle mb-3" 
                     style={{ backgroundColor: `${getHealthStatusHexColor()}20` }}>
                  <i className="fas fa-heartbeat fa-3x" style={{ color: getHealthStatusHexColor() }}></i>
                </div>
                <h4 style={{ color: getHealthStatusHexColor() }}>
                  {getHealthStatusColor() === 'success' ? 'Healthy' : 
                   getHealthStatusColor() === 'warning' ? 'Moderate Risk' : 
                   getHealthStatusColor() === 'danger' ? 'High Risk' : 'No Data'}
                </h4>
              </div>
              <div className="mt-4">
                <Link to="/ml-prediction" className="btn btn-primary mx-2" style={{ backgroundColor: '#F97316', borderColor: '#F97316', color: 'white', transition: 'all 0.3s ease' }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#E86D10'; 
                    e.currentTarget.style.borderColor = '#E86D10';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = '#F97316';
                    e.currentTarget.style.borderColor = '#F97316';
                  }}>
                  <i className="fas fa-vial me-2"></i>
                  New Test
                </Link>
                <Link to="/prediction-history" className="btn btn-outline-secondary mx-2" style={{ color: '#64748B', borderColor: '#CBD5E1', transition: 'all 0.3s ease' }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#64748B';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#64748B';
                  }}>
                  <i className="fas fa-history me-2"></i>
                  History
                </Link>
              </div>
            </Card.Body>
          </Card>
        </Col>
        
        <Col lg={4} md={12}>
          <Card className="h-100 border-0 shadow-sm">
            <Card.Body>
              <h5 className="text-muted mb-3">Recent Results</h5>
              <div className="d-flex justify-content-between mb-4">
                <div className="p-3 text-center border rounded flex-fill mx-1" style={{ backgroundColor: '#FFF7ED' }}>
                  <h3 className="mb-0" style={{ color: '#22C55E' }}>{predictionStats?.normal || 0}</h3>
                  <p className="text-muted mb-0 small">Normal</p>
                </div>
                <div className="p-3 text-center border rounded flex-fill mx-1" style={{ backgroundColor: '#FFF7ED' }}>
                  <h3 className="mb-0" style={{ color: '#F97316' }}>{predictionStats?.abnormal || 0}</h3>
                  <p className="text-muted mb-0 small">Abnormal</p>
                </div>
              </div>
              
              <h6 className="text-muted mb-3">Quick Links</h6>
              <div className="d-grid gap-2">
                <Link to="/ml-prediction" className="btn btn-outline-primary text-start">
                  <i className="fas fa-vial me-2"></i>
                  Make Health Prediction
                </Link>
                <Link to="/prediction-history" className="btn btn-outline-secondary text-start">
                  <i className="fas fa-history me-2"></i>
                  View Test History
                </Link>
                <Link to="/health-tips" className="btn btn-outline-info text-start" style={{ transition: 'all 0.3s ease' }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#0dcaf0';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#0dcaf0';
                  }}>
                  <i className="fas fa-lightbulb me-2"></i>
                  Kidney Health Tips
                </Link>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      {predictionStats?.latest && (
        <Row>
          <Col md={12}>
            <Card className="mb-4 border-0 shadow-sm">
              <Card.Header className="bg-white border-bottom-0">
                <div className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Latest Prediction</h5>
                  <span className="text-muted small">
                    <i className="far fa-clock me-1"></i>
                    {predictionStats.latest.date ? new Date(predictionStats.latest.date).toLocaleString() : 'N/A'}
                  </span>
                </div>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6}>
                    <h6 className="mb-3 text-primary">
                      <i className="fas fa-flask me-2"></i>
                      Input Parameters
                    </h6>
                    {predictionStats.latest.parameters && (
                      <div className="table-responsive">
                        {/* Check if this is legacy data (old 6-param) or new 9-param */}
                        {predictionStats.latest.parameters.gravity && !predictionStats.latest.parameters.specificGravity ? (
                          // Legacy data display
                          <>
                            <div className="mb-2">
                              <Badge bg="warning">Legacy Data</Badge>
                            </div>
                            <table className="table table-hover table-sm">
                              <tbody>
                                <tr>
                                  <th className="text-nowrap">Specific Gravity:</th>
                                  <td>{predictionStats.latest.parameters.gravity}</td>
                                </tr>
                                <tr>
                                  <th className="text-nowrap">pH Value:</th>
                                  <td>{predictionStats.latest.parameters.ph}</td>
                                </tr>
                                <tr>
                                  <th className="text-nowrap">Osmolality:</th>
                                  <td>{predictionStats.latest.parameters.osmo}</td>
                                </tr>
                                <tr>
                                  <th className="text-nowrap">Conductivity:</th>
                                  <td>{predictionStats.latest.parameters.cond}</td>
                                </tr>
                                <tr>
                                  <th className="text-nowrap">Urea:</th>
                                  <td>{predictionStats.latest.parameters.urea}</td>
                                </tr>
                                <tr>
                                  <th className="text-nowrap">Calcium:</th>
                                  <td>{predictionStats.latest.parameters.calc}</td>
                                </tr>
                              </tbody>
                            </table>
                          </>
                        ) : (
                          // New 9-parameter display
                          <table className="table table-hover table-sm">
                            <tbody>
                              <tr>
                                <th className="text-nowrap">pH:</th>
                                <td>{predictionStats.latest.parameters.ph || 'N/A'}</td>
                              </tr>
                              <tr>
                                <th className="text-nowrap">TDS:</th>
                                <td>{predictionStats.latest.parameters.tds || 'N/A'} ppm</td>
                              </tr>
                              {/* Fallback logic handles both camelCase (schema) and lowercase (CSV legacy) keys */}
                              <tr>
                                <th className="text-nowrap">Specific Gravity:</th>
                                <td>{predictionStats.latest.parameters.specificGravity || predictionStats.latest.parameters.specificgravity || predictionStats.latest.parameters?.parameters?.specificGravity || 'N/A'}</td>
                              </tr>
                              <tr>
                                <th className="text-nowrap">Turbidity NTU:</th>
                                <td>{predictionStats.latest.parameters.turbidityNTU || predictionStats.latest.parameters.turbidityntu || predictionStats.latest.parameters?.parameters?.turbidityNTU || 'N/A'}</td>
                              </tr>
                              <tr>
                                <th className="text-nowrap">RGB Color:</th>
                                <td>
                                  {predictionStats.latest.parameters.red !== undefined ? (
                                    <>
                                      <div
                                        style={{
                                          width: 20,
                                          height: 20,
                                          backgroundColor: `rgb(${predictionStats.latest.parameters.red},${predictionStats.latest.parameters.green},${predictionStats.latest.parameters.blue})`,
                                          border: '1px solid #ccc',
                                          borderRadius: '4px',
                                          display: 'inline-block',
                                          marginRight: '8px'
                                        }}
                                        title={`RGB(${predictionStats.latest.parameters.red},${predictionStats.latest.parameters.green},${predictionStats.latest.parameters.blue})`}
                                      />
                                      ({predictionStats.latest.parameters.red},{predictionStats.latest.parameters.green},{predictionStats.latest.parameters.blue})
                                    </>
                                  ) : 'N/A'}
                                </td>
                              </tr>
                              <tr>
                                <th className="text-nowrap">Turbidity Level:</th>
                                <td>{predictionStats.latest.parameters.turbidityLevel || predictionStats.latest.parameters.turbiditylevel || predictionStats.latest.parameters?.parameters?.turbidityLevel || 'N/A'}</td>
                              </tr>
                              <tr>
                                <th className="text-nowrap">Warna Dasar:</th>
                                <td>{predictionStats.latest.parameters.warnaDasar || predictionStats.latest.parameters.warnadasar || predictionStats.latest.parameters?.parameters?.warnaDasar || 'N/A'}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </Col>
                  <Col md={6}>
                    <h6 className="mb-3 text-primary">
                      <i className="fas fa-chart-pie me-2"></i>
                      Prediction Result
                    </h6>
                    <div className="text-center p-4 mb-3">
                      {(() => {
                        // Use the new encrypted penyakit field (Indonesian disease status)
                        const penyakit = predictionStats.latest.penyakit;
                        
                        return penyakit === 'Batu Ginjal' ? (
                          <div className="p-4 rounded bg-danger bg-opacity-10">
                            <i className="fas fa-exclamation-circle fa-3x text-danger mb-3"></i>
                            <h4 className="text-danger">Batu Ginjal</h4>
                            <p className="mb-0">Potential kidney stone risk detected</p>
                            <div className="mt-3 p-2 bg-light rounded">
                              <span className="text-muted small">
                                Please consult with a healthcare professional for further evaluation.
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 rounded bg-success bg-opacity-10">
                            <i className="fas fa-check-circle fa-3x text-success mb-3"></i>
                            <h4 className="text-success">Sehat</h4>
                            <p className="mb-0">No kidney health issues detected</p>
                            <div className="mt-3 p-2 bg-light rounded">
                              <span className="text-muted small">
                                Continue to monitor your kidney health regularly.
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                      
                      {predictionStats.latest.hydrationAnalysis && (
                        <div className="mt-3 p-3 border rounded" style={{ backgroundColor: predictionStats.latest.hydrationAnalysis.needsWater ? '#FFF3CD' : '#D1F2EB' }}>
                          <h6 className="mb-2">
                            <i className="fas fa-tint me-2"></i>
                            Hydration Status
                          </h6>
                          <Badge bg={predictionStats.latest.hydrationAnalysis.needsWater ? 'warning' : 'success'} className="mb-2">
                            {predictionStats.latest.hydrationAnalysis.hydrationStatus}
                          </Badge>
                          <p className="small mb-0">
                            {predictionStats.latest.hydrationAnalysis.recommendation}
                          </p>
                        </div>
                      )}
                      
                      <div className="mt-4">
                        <Link to="/prediction-history" className="btn btn-outline-primary">
                          <i className="fas fa-history me-2"></i>
                          View All Predictions
                        </Link>
                      </div>
                    </div>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
    </Container>
  );
};

export default Dashboard; 