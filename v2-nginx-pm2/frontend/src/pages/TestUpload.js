import React, { useState, useRef } from 'react';
import axios from 'axios';
import { Container, Form, Button, Card } from 'react-bootstrap';

const TestUpload = () => {
  const [file, setFile] = useState(null);
  const [name, setName] = useState('Test User');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleNameChange = (e) => {
    setName(e.target.value);
  };

  // Create FormData without an image (name-only update)
  const handleNameOnlySubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', name);
      
      const token = localStorage.getItem('token');
      console.log('Submitting name-only update');
      
      // Test direct fetch API approach
      const response = await fetch('https://172.29.156.41:7763/api/auth/me', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData,
        // Needed for self-signed certificates
        agent: {
          rejectUnauthorized: false
        }
      });
      
      const data = await response.json();
      setResult({
        status: response.status,
        statusText: response.statusText,
        data: data
      });
      
      console.log('Success:', data);
    } catch (err) {
      console.error('Error in name-only update:', err);
      setError({
        message: err.message,
        type: 'name-only-update'
      });
    } finally {
      setLoading(false);
    }
  };

  // Test with axios
  const handleAxiosSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      // Create FormData
      const formData = new FormData();
      formData.append('name', name);
      
      if (file) {
        formData.append('profileImage', file);
      }

      // Get token
      const token = localStorage.getItem('token');

      // Log what we're submitting
      console.log('Test Upload Submission with Axios:', {
        name,
        fileType: file ? file.type : 'No file',
        fileSize: file ? `${(file.size / 1024).toFixed(2)} KB` : 'No file',
        fileName: file ? file.name : 'No file'
      });

      // Force protocol to HTTPS explicitly 
      const apiUrl = 'https://172.29.156.41:7763/api/auth/me';
      
      const axiosInstance = axios.create({
        httpsAgent: {
          rejectUnauthorized: false
        }
      });
      
      const response = await axiosInstance({
        method: 'PUT',
        url: apiUrl,
        headers: {
          'Authorization': `Bearer ${token}`
        },
        data: formData,
        withCredentials: false,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      setResult({
        status: response.status,
        statusText: response.statusText,
        data: response.data
      });
      
      console.log('Axios Success:', response.data);
    } catch (err) {
      console.error('Error in axios upload:', err);
      
      let errorInfo = {
        message: err.message,
        type: 'axios-upload'
      };
      
      if (err.response) {
        errorInfo = {
          ...errorInfo,
          status: err.response.status,
          statusText: err.response.statusText,
          data: err.response.data
        };
      }
      
      setError(errorInfo);
    } finally {
      setLoading(false);
    }
  };

  // Original form submission handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Use XMLHttpRequest directly
    setLoading(true);
    setResult(null);
    setError(null);
    
    try {
      const xhr = new XMLHttpRequest();
      const token = localStorage.getItem('token');
      
      // Use event listeners
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Success
          const responseData = JSON.parse(xhr.responseText);
          setResult({
            status: xhr.status,
            statusText: xhr.statusText,
            data: responseData
          });
          console.log('XHR Success:', responseData);
        } else {
          // Error
          setError({
            status: xhr.status,
            statusText: xhr.statusText,
            data: xhr.responseText,
            type: 'xhr-error'
          });
          console.error('XHR Error:', xhr.status, xhr.statusText);
        }
        setLoading(false);
      };
      
      xhr.onerror = function() {
        setError({
          message: 'Network error occurred',
          type: 'xhr-network-error'
        });
        console.error('XHR Network Error');
        setLoading(false);
      };
      
      // Open connection - explicitly using HTTPS
      xhr.open('PUT', 'https://172.29.156.41:7763/api/auth/me', true);
      
      // Set headers
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      
      // Create FormData
      const formData = new FormData();
      formData.append('name', name);
      
      if (file) {
        formData.append('profileImage', file);
      }
      
      // Send the request
      xhr.send(formData);
      
    } catch (err) {
      console.error('Error in XHR upload:', err);
      setError({
        message: err.message,
        type: 'xhr-exception'
      });
      setLoading(false);
    }
  };

  return (
    <Container className="py-5">
      <h1>Test Profile Image Upload</h1>
      
      <Card className="mb-4">
        <Card.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={handleNameChange}
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Profile Image</Form.Label>
              <Form.Control
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <Form.Text className="text-muted">
                Select an image file (JPEG, PNG, GIF)
              </Form.Text>
            </Form.Group>
            
            <div className="d-flex gap-2">
              <Button 
                variant="primary"
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? 'Using XHR...' : 'Submit with XHR'}
              </Button>
              
              <Button 
                variant="secondary"
                onClick={handleAxiosSubmit}
                disabled={loading}
              >
                {loading ? 'Using Axios...' : 'Submit with Axios'}
              </Button>
              
              <Button 
                variant="info"
                onClick={handleNameOnlySubmit}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Name Only (Fetch API)'}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
      
      {error && (
        <Card className="mb-4 border-danger">
          <Card.Header className="bg-danger text-white">
            Error: {error.status} {error.statusText} - Type: {error.type}
          </Card.Header>
          <Card.Body>
            <pre>{JSON.stringify(error, null, 2)}</pre>
          </Card.Body>
        </Card>
      )}
      
      {result && (
        <Card className="mb-4 border-success">
          <Card.Header className="bg-success text-white">
            Success: {result.status} {result.statusText}
          </Card.Header>
          <Card.Body>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
};

export default TestUpload; 