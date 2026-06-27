import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Alert, ListGroup } from 'react-bootstrap';
import axios from 'axios';
import config from '../config';

const DebugPage = () => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState('https');
  const [customUrl, setCustomUrl] = useState(window.location.hostname + ':7763');
  const [systemInfo, setSystemInfo] = useState({});
  const [adminStatus, setAdminStatus] = useState(null);

  // Add a log to the results
  const addLog = (message, type = 'info') => {
    setResults(prev => [
      { id: Date.now(), message, type, timestamp: new Date().toISOString() },
      ...prev
    ]);
  };

  // Test API connectivity using the specified protocol
  const testConnection = async () => {
    setLoading(true);
    const url = `${selectedProtocol}://${customUrl}/api/auth/healthcheck`;
    
    try {
      addLog(`Testing connection to: ${url}`, 'info');
      
      const response = await axios.get(url, {
        timeout: 5000,
        validateStatus: () => true // Accept any status code
      });
      
      addLog(`Response status: ${response.status}`, response.status < 300 ? 'success' : 'warning');
      addLog(`Response data: ${JSON.stringify(response.data)}`, 'success');
    } catch (error) {
      addLog(`Error: ${error.message}`, 'danger');
      
      if (error.message.includes('Network Error')) {
        addLog('Network error suggests server is unreachable. Check if services are running.', 'danger');
      }
      
      if (error.message.includes('plain HTTP request was sent to HTTPS')) {
        addLog('Protocol mismatch: HTTP request sent to HTTPS port. Try switching to HTTPS protocol.', 'danger');
      }
      
      if (error.message.includes('Mixed Content')) {
        addLog('Mixed Content error: Cannot load HTTP resources from HTTPS page. Try a direct HTTP connection.', 'danger');
      }
      
      if (error.message.includes('certificate')) {
        addLog('SSL certificate issue. Try using HTTP instead or install proper certificates.', 'danger');
      }
    }
    
    setLoading(false);
  };
  
  // Test direct health endpoint
  const testHealth = async () => {
    setLoading(true);
    try {
      addLog(`Testing health endpoint with ${selectedProtocol} protocol`, 'info');
      const response = await axios.get(`${selectedProtocol}://${customUrl}/api/health`, {
        timeout: 5000,
        validateStatus: () => true
      });
      
      if (response.status === 200) {
        setSystemInfo(response.data);
        addLog(`Health check successful - System info retrieved`, 'success');
      } else {
        addLog(`Health check failed - Status: ${response.status}`, 'warning');
      }
    } catch (error) {
      addLog(`Health check error: ${error.message}`, 'danger');
    }
    setLoading(false);
  };
  
  // Quick fix to try to redirect from HTTP to HTTPS
  const attemptProtocolFix = () => {
    const currentUrl = window.location.href;
    if (currentUrl.startsWith('http:')) {
      const httpsUrl = currentUrl.replace('http:', 'https:');
      addLog(`Attempting to redirect from HTTP to HTTPS: ${httpsUrl}`, 'info');
      window.location.href = httpsUrl;
    } else {
      addLog('You are already using HTTPS', 'info');
    }
  };

  // Check and create admin user if needed
  const checkAdminUser = async () => {
    setLoading(true);
    try {
      addLog(`Checking user status in HIBAH backend`, 'info');
      const response = await axios.get(`${window.location.protocol}//${window.location.hostname}:7764/api/debug/users`, {
        timeout: 5000,
        validateStatus: () => true
      });
      
      addLog(`User status: ${JSON.stringify(response.data)}`, 'info');
      setAdminStatus(response.data);
      
      if (response.data.userCount === 0) {
        addLog('No users found. Attempting to create default admin user...', 'warning');
        const createResponse = await axios.get(`${window.location.protocol}//${window.location.hostname}:7764/api/debug/users?createAdmin=true`, {
          timeout: 5000,
          validateStatus: () => true
        });
        
        if (createResponse.data.success) {
          addLog(`Default admin user created successfully: ${JSON.stringify(createResponse.data.defaultCredentials)}`, 'success');
          setAdminStatus(createResponse.data);
        } else {
          addLog(`Failed to create admin user: ${createResponse.data.message}`, 'danger');
        }
      }
    } catch (error) {
      addLog(`Error checking user status: ${error.message}`, 'danger');
      addLog('This may indicate that the gateway service is not running or is inaccessible', 'warning');
    }
    setLoading(false);
  };

  // Perform direct login via HTTP
  const performDirectLogin = async () => {
    setLoading(true);
    try {
      addLog(`Attempting direct login to http://${window.location.hostname}:7764/api/direct-login`, 'info');
      
      const response = await axios.post(`http://${window.location.hostname}:7764/api/direct-login`, {
        email: 'admin@example.com',
        password: 'admin123'
      }, {
        timeout: 5000,
        validateStatus: () => true
      });
      
      addLog(`Direct login response status: ${response.status}`, response.status < 300 ? 'success' : 'warning');
      
      if (response.data.success && response.data.token) {
        // Store token and user data
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        addLog(`Login successful! Token stored. Redirecting to dashboard...`, 'success');
        
        // Add a small delay to show the success message
        setTimeout(() => {
          window.location.href = '/admin';
        }, 1500);
      } else {
        addLog(`Login failed: ${JSON.stringify(response.data)}`, 'danger');
      }
    } catch (error) {
      addLog(`Error with direct login: ${error.message}`, 'danger');
      addLog('This may indicate that the HIBAH gateway service is not running on port 7764', 'warning');
    }
    setLoading(false);
  };

  // Diagnostic checks for HIBAH services
  const runDiagnostics = async () => {
    setLoading(true);
    addLog('Running diagnostics on HIBAH services...', 'info');
    
    // Check Gateway
    try {
      const gatewayResponse = await axios.get(`http://${window.location.hostname}:7764/api/health`, {
        timeout: 3000,
        validateStatus: () => true
      });
      addLog(`Gateway service (port 7764): ${gatewayResponse.status === 200 ? 'OK' : 'ERROR'}`, 
             gatewayResponse.status === 200 ? 'success' : 'danger');
    } catch (error) {
      addLog(`Gateway service (port 7764): UNREACHABLE - ${error.message}`, 'danger');
    }
    
    // Check User Service
    try {
      const userResponse = await axios.get(`http://${window.location.hostname}:3001/health`, {
        timeout: 3000,
        validateStatus: () => true
      });
      addLog(`User service (port 3001): ${userResponse.status === 200 ? 'OK' : 'ERROR'}`, 
             userResponse.status === 200 ? 'success' : 'danger');
    } catch (error) {
      addLog(`User service (port 3001): UNREACHABLE - ${error.message}`, 'danger');
    }
    
    // Check ML Service
    try {
      const mlResponse = await axios.get(`http://${window.location.hostname}:3002/health`, {
        timeout: 3000,
        validateStatus: () => true
      });
      addLog(`ML service (port 3002): ${mlResponse.status === 200 ? 'OK' : 'ERROR'}`, 
             mlResponse.status === 200 ? 'success' : 'danger');
    } catch (error) {
      addLog(`ML service (port 3002): UNREACHABLE - ${error.message}`, 'danger');
    }
    
    // Check HTTPS Gateway via NGINX
    try {
      const httpsResponse = await axios.get(`https://${window.location.hostname}:7763/api/health`, {
        timeout: 3000,
        validateStatus: () => true
      });
      addLog(`NGINX HTTPS proxy (port 7763): ${httpsResponse.status === 200 ? 'OK' : 'ERROR'}`, 
             httpsResponse.status === 200 ? 'success' : 'danger');
    } catch (error) {
      addLog(`NGINX HTTPS proxy (port 7763): UNREACHABLE - ${error.message}`, 'danger');
    }
    
    setLoading(false);
  };

  // Show current configuration
  useEffect(() => {
    addLog(`Current config.apiUrl: ${config.apiUrl}`, 'info');
    addLog(`Browser location: ${window.location.href}`, 'info');
    addLog(`Browser protocol: ${window.location.protocol}`, 'info');
    addLog(`Expected API URL: ${selectedProtocol}://${customUrl}/api/auth/login`, 'info');
  }, [selectedProtocol, customUrl]);

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Card className="mb-4">
            <Card.Header as="h5">HIBAH System Troubleshooter</Card.Header>
            <Card.Body>
              <Alert variant="info">
                <h6>Current Browser Protocol: <strong>{window.location.protocol}</strong></h6>
                <h6>Current API URL: <strong>{config.apiUrl}</strong></h6>
                
                {window.location.protocol === 'https:' && config.apiUrl.startsWith('http:') && (
                  <Alert variant="danger">
                    <strong>Mixed Content Issue Detected!</strong> Your page is loaded over HTTPS but trying to make API calls over HTTP.
                    This will be blocked by most browsers.
                  </Alert>
                )}
                
                {window.location.protocol === 'http:' && config.apiUrl.startsWith('https:') && (
                  <Alert variant="warning">
                    <strong>Protocol Mismatch!</strong> Your page is loaded over HTTP but trying to make API calls over HTTPS.
                    While this may work, it's better to use the same protocol.
                  </Alert>
                )}
              </Alert>

              <Alert variant="warning">
                <h5>502 Bad Gateway Troubleshooting</h5>
                <p>
                  If you're seeing a 502 Bad Gateway error, this means NGINX can't connect to the backend server.
                  Most likely causes are:
                </p>
                <ol>
                  <li>The HIBAH gateway service is not running on port 7764</li>
                  <li>The gateway service is running but can't connect to MongoDB</li>
                  <li>The NGINX proxy configuration is incorrect (ensure it points to HIBAH folder)</li>
                </ol>
                <p><strong>Current configuration:</strong> NGINX on port 7763 (HTTPS) → Gateway on port 7764 (HTTP)</p>
              </Alert>
              
              <Alert variant="warning">
                <h5>404 Not Found Troubleshooting</h5>
                <p>
                  If you're seeing a 404 Not Found error, this could be caused by:
                </p>
                <ol>
                  <li>The frontend build files are not properly deployed to /var/www/html/HIBAH/frontend</li>
                  <li>NGINX is pointing to the wrong directory (should be /var/www/html/HIBAH/frontend)</li>
                  <li>The React app's routing isn't properly configured</li>
                </ol>
              </Alert>
              
              <div className="d-flex flex-wrap gap-2 mb-3">
                <Button 
                  variant="warning" 
                  onClick={attemptProtocolFix}
                  className="mb-1"
                >
                  Attempt Auto-Fix (HTTP → HTTPS)
                </Button>

                <Button 
                  variant="info" 
                  onClick={runDiagnostics}
                  className="mb-1"
                  disabled={loading}
                >
                  Run HIBAH Service Diagnostics
                </Button>
                
                <Button 
                  variant="success" 
                  onClick={checkAdminUser}
                  className="mb-1"
                  disabled={loading}
                >
                  Check/Create Admin User
                </Button>
                
                <Button 
                  variant="primary" 
                  onClick={performDirectLogin}
                  className="mb-1"
                  disabled={loading}
                >
                  Login via HTTP (Bypass HTTPS Issues)
                </Button>
              </div>
              
              {adminStatus && (
                <Alert variant={adminStatus.success ? 'success' : 'danger'}>
                  <h6>User Status</h6>
                  <p>User Count: {adminStatus.userCount}</p>
                  {adminStatus.defaultCredentials && (
                    <div>
                      <p>Default Admin Created:</p>
                      <ul>
                        <li>Email: {adminStatus.defaultCredentials.email}</li>
                        <li>Password: {adminStatus.defaultCredentials.password}</li>
                      </ul>
                    </div>
                  )}
                  {adminStatus.hint && <p><strong>Hint:</strong> {adminStatus.hint}</p>}
                </Alert>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      <Row>
        <Col>
          <Card>
            <Card.Header as="h5">API Connection Test</Card.Header>
            <Card.Body>
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Protocol</Form.Label>
                  <Form.Select 
                    value={selectedProtocol}
                    onChange={(e) => setSelectedProtocol(e.target.value)}
                  >
                    <option value="https">HTTPS</option>
                    <option value="http">HTTP</option>
                  </Form.Select>
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Host:Port</Form.Label>
                  <Form.Control 
                    type="text" 
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                  />
                  <Form.Text className="text-muted">
                    Format: hostname:port (e.g., localhost:7763)
                  </Form.Text>
                </Form.Group>
                
                <div className="d-flex gap-2">
                  <Button 
                    variant="primary" 
                    onClick={testConnection}
                    disabled={loading}
                  >
                    {loading ? 'Testing...' : 'Test Authentication'}
                  </Button>
                  
                  <Button 
                    variant="secondary" 
                    onClick={testHealth}
                    disabled={loading}
                  >
                    {loading ? 'Testing...' : 'Test Health Endpoint'}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      {Object.keys(systemInfo).length > 0 && (
        <Row className="mt-4">
          <Col>
            <Card>
              <Card.Header as="h5">System Information</Card.Header>
              <Card.Body>
                <ListGroup variant="flush">
                  <ListGroup.Item>
                    <strong>Gateway Status:</strong> {systemInfo.status}
                  </ListGroup.Item>
                  <ListGroup.Item>
                    <strong>Database Connection:</strong> {systemInfo.database?.connection}
                  </ListGroup.Item>
                  <ListGroup.Item>
                    <strong>Server Protocol:</strong> {systemInfo.request?.protocol}
                  </ListGroup.Item>
                  <ListGroup.Item>
                    <strong>X-Forwarded-Proto:</strong> {systemInfo.request?.headers?.['x-forwarded-proto'] || 'Not set'}
                  </ListGroup.Item>
                </ListGroup>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
      
      <Row className="mt-4">
        <Col>
          <Card>
            <Card.Header as="h5">Results</Card.Header>
            <Card.Body>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {results.map(log => (
                  <Alert key={log.id} variant={log.type}>
                    <small className="text-muted">{log.timestamp}</small><br/>
                    {log.message}
                  </Alert>
                ))}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default DebugPage; 