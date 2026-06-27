// NOTE: Manual Input UI has been temporarily disabled per user request
// All manual input related code is marked with "HAPUS SAYA" comments
// DO NOT DELETE until user confirms removal

import React, { useState, useEffect } from 'react';
import { Alert, Card, Table, Spinner, Form, Button, Nav, Badge } from 'react-bootstrap';
import { mlAPI, predictionAPI } from '../services/api';
import './MLPrediction.css';

const MLPrediction = () => {
  const [file, setFile] = useState(null);
  // HAPUS SAYA - Manual Input State (lines 8-18)
  /*
  const [singleRecord, setSingleRecord] = useState({
    ph: '',
    tds: '',
    specificGravity: '',
    turbidityNTU: '',
    red: 255,
    green: 220,
    blue: 150,
    turbidityLevel: 'Jernih',
    warnaDasar: 'KUNING'
  });
  */
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [csvPreview, setCsvPreview] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('csv'); // Changed from 'manual' to 'csv' - HAPUS SAYA related
  const [model, setModel] = useState(null);
  const [loadingModelInfo, setLoadingModelInfo] = useState(true);
  
  // Auto Data state
  const [autoData, setAutoData] = useState([]);
  const [loadingAutoData, setLoadingAutoData] = useState(false);
  const [autoDataError, setAutoDataError] = useState('');

  // Fetch model when component mounts
  useEffect(() => {
    const fetchModel = async () => {
      try {
        setLoadingModelInfo(true);
        setError('');
        
        // Use the models endpoint to get all models
        const response = await mlAPI.getModels();
        
        // Check if models exist in the response.data.data array (correct format)
        if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
          // Find an active model, if any
          const activeModel = response.data.data.find(m => m.active === true);
          
          // Use either the active model or the first model
          const modelToUse = activeModel || response.data.data[0];
          
          setModel({
            id: modelToUse._id,
            name: modelToUse.name,
            version: modelToUse.version,
            accuracy: modelToUse.accuracy,
            description: modelToUse.description || 'Model found in MODEL-ML/joblib directory'
          });
        } 
        // Fallback for older response format with availableModels
        else if (response.data && response.data.availableModels && response.data.availableModels.joblib) {
          setModel({
            id: 'kidney_stone_model',
            name: 'Kidney Stone Model',
            version: '1.0',
            accuracy: 0.95,
            description: 'Model loaded from DATASET folder'
          });
        }
        else {
          // If we have a success response but no model, show appropriate message
          setError('No prediction models available. Please contact an administrator to upload a model file.');
        }
      } catch (err) {
        // Show a more helpful error message
        if (err.response && err.response.status === 404) {
          setError('The ML model endpoint is not available. Please check server configuration.');
        } else if (err.response && err.response.status === 500) {
          setError('Server error occurred when loading model information. Please try again later.');
        } else {
          setError('Failed to load Kidney Stone model: ' + (err.message || 'Unknown error'));
        }
        
        // Set a fallback model to allow the interface to work in development
        if (process.env.NODE_ENV === 'development') {
          setModel({
            id: 'fallback_model',
            name: 'Fallback Model (Dev Mode)',
            version: '1.0',
            accuracy: 0.9,
            description: 'Fallback model for development - no real model loaded'
          });
        }
      } finally {
        setLoadingModelInfo(false);
      }
    };

    fetchModel();
  }, []);
  
  // Fetch auto data when the tab is selected
  useEffect(() => {
    if (activeTab === 'auto') {
      fetchAutoData();
    }
  }, [activeTab]);
  
  // Function to fetch auto data from devices
  const fetchAutoData = async () => {
    try {
      setLoadingAutoData(true);
      setAutoDataError('');
      
      const response = await mlAPI.getAutoData({ limit: 20 }); // Get latest 20 entries
      
      if (response.data && response.data.success && response.data.data) {
        setAutoData(response.data.data);
      } else {
        setAutoDataError('No auto data available');
        setAutoData([]);
      }
    } catch (err) {
      setAutoDataError('Failed to fetch automatic data: ' + (err.message || 'Unknown error'));
      setAutoData([]);
    } finally {
      setLoadingAutoData(false);
    }
  };
  
  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Helper function: Validate CSV file before upload
  const validateCSVFile = (file) => {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
    const ALLOWED_EXTENSIONS = ['.csv'];
    const ALLOWED_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];

    // Check if file exists
    if (!file) {
      return { valid: false, error: 'Please select a CSV file' };
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
    if (!hasValidExtension) {
      return { 
        valid: false, 
        error: 'Invalid file type. Please upload a .csv file' 
      };
    }

    // Check MIME type
    if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
      return { 
        valid: false, 
        error: `Invalid file format (${file.type}). Please upload a valid CSV file` 
      };
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      return { 
        valid: false, 
        error: `File too large (${sizeMB}MB). Maximum allowed size is 10MB` 
      };
    }

    // Check if file is empty
    if (file.size === 0) {
      return { 
        valid: false, 
        error: 'The selected file is empty' 
      };
    }

    return { valid: true, error: null };
  };

  // Helper function: Normalize lowercase CSV keys to camelCase
  const normalizeKeysToLowerCase = (obj) => {
    const keyMapping = {
      'specificgravity': 'specificGravity',
      'turbidityntu': 'turbidityNTU',
      'turbiditylevel': 'turbidityLevel',
      'warnadasar': 'warnaDasar'
    };
    
    const normalized = { ...obj };
    Object.keys(keyMapping).forEach(lowercaseKey => {
      if (normalized[lowercaseKey] !== undefined) {
        normalized[keyMapping[lowercaseKey]] = normalized[lowercaseKey];
        delete normalized[lowercaseKey];
      }
    });
    return normalized;
  };

  // Helper function: Preview CSV headers and validate structure
  const previewCSVHeaders = (file) => {
    return new Promise((resolve, reject) => {
      const REQUIRED_HEADERS = ['ph', 'tds', 'specificgravity', 'turbidityntu', 'red', 'green', 'blue', 'turbiditylevel', 'warnadasar'];
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const lines = text.split('\n').filter(line => line.trim());
          
          if (lines.length === 0) {
            reject({ error: 'CSV file is empty' });
            return;
          }

          // Auto-detect delimiter (comma or semicolon)
          const headerLine = lines[0];
          let delimiter = ',';
          if (headerLine.includes(';') && !headerLine.includes(',')) {
            delimiter = ';';
          }

          // Parse headers (first line)
          const headers = headerLine.split(delimiter).map(h => h.trim().toLowerCase());
          
          // Check for required headers
          const missingHeaders = REQUIRED_HEADERS.filter(req => !headers.includes(req));
          if (missingHeaders.length > 0) {
            reject({ 
              error: `Missing required columns: ${missingHeaders.join(', ')}. Your CSV must have these columns: ${REQUIRED_HEADERS.join(', ')}. Found: ${headers.join(', ')}` 
            });
            return;
          }

          // Parse first 3 data rows for preview
          const previewRows = [];
          for (let i = 1; i < Math.min(4, lines.length); i++) {
            const values = lines[i].split(delimiter).map(v => v.trim());
            const row = {};
            headers.forEach((header, idx) => {
              if (REQUIRED_HEADERS.includes(header)) {
                row[header] = values[idx] || 'N/A';
              }
            });
            previewRows.push(row);
          }

          // Normalize lowercase keys to camelCase for table display
          const normalizedPreviewRows = previewRows.map(row => normalizeKeysToLowerCase(row));

          resolve({
            headers,
            delimiter,
            totalRows: lines.length - 1, // excluding header
            previewRows: normalizedPreviewRows,
            valid: true
          });
        } catch (err) {
          reject({ error: `Failed to parse CSV: ${err.message}` });
        }
      };

      reader.onerror = () => {
        reject({ error: 'Failed to read file' });
      };

      // Read first 1KB for preview (enough for headers + few rows)
      const blob = file.slice(0, 1024);
      reader.readAsText(blob);
    });
  };

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    
    // Reset previous state
    setFile(null);
    setCsvPreview(null);
    setError('');
    
    if (!selectedFile) {
      return;
    }

    // Validate file
    const validation = validateCSVFile(selectedFile);
    if (!validation.valid) {
      setError(validation.error);
      e.target.value = ''; // Clear the file input
      return;
    }

    // Generate preview
    try {
      const preview = await previewCSVHeaders(selectedFile);
      setCsvPreview(preview);
      setFile(selectedFile);
    } catch (err) {
      setError(err.error || 'Failed to preview CSV file');
      e.target.value = ''; // Clear the file input
    }
  };

  // HAPUS SAYA - handleInputChange for Manual Input (line ~315)
  /*
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSingleRecord({ ...singleRecord, [name]: value });
  };
  */

  // HAPUS SAYA - validateSingleRecord function (lines 320-390)
  /*
  const validateSingleRecord = () => {
    const validTurbidityLevels = ['Jernih', 'Agak Keruh', 'Keruh'];
    const validWarnaOptions = ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU'];
    
    // pH validation (4.5 - 8.0)
    const ph = parseFloat(singleRecord.ph);
    if (!singleRecord.ph || isNaN(ph) || ph < 4.5 || ph > 8.0) {
      setError('pH must be between 4.5 and 8.0');
      return false;
    }
    
    // TDS validation (0 - 2000 ppm)
    const tds = parseFloat(singleRecord.tds);
    if (!singleRecord.tds || isNaN(tds) || tds < 0 || tds > 2000) {
      setError('TDS must be between 0 and 2000 ppm');
      return false;
    }
    
    // Specific Gravity validation (1.005 - 1.030)
    const sg = parseFloat(singleRecord.specificGravity);
    if (!singleRecord.specificGravity || isNaN(sg) || sg < 1.005 || sg > 1.030) {
      setError('Specific Gravity must be between 1.005 and 1.030');
      return false;
    }
    
    // Turbidity NTU validation (0 - 100)
    const ntu = parseFloat(singleRecord.turbidityNTU);
    if (!singleRecord.turbidityNTU || isNaN(ntu) || ntu < 0 || ntu > 100) {
      setError('Turbidity NTU must be between 0 and 100');
      return false;
    }
    
    // Red validation (0 - 255)
    const red = parseInt(singleRecord.red);
    if (singleRecord.red === '' || isNaN(red) || red < 0 || red > 255) {
      setError('Red value must be between 0 and 255');
      return false;
    }
    
    // Green validation (0 - 255)
    const green = parseInt(singleRecord.green);
    if (singleRecord.green === '' || isNaN(green) || green < 0 || green > 255) {
      setError('Green value must be between 0 and 255');
      return false;
    }
    
    // Blue validation (0 - 255)
    const blue = parseInt(singleRecord.blue);
    if (singleRecord.blue === '' || isNaN(blue) || blue < 0 || blue > 255) {
      setError('Blue value must be between 0 and 255');
      return false;
    }
    
    // Turbidity Level validation
    if (!validTurbidityLevels.includes(singleRecord.turbidityLevel)) {
      setError('Please select a valid turbidity level');
      return false;
    }
    
    // Warna Dasar validation
    if (!validWarnaOptions.includes(singleRecord.warnaDasar)) {
      setError('Please select a valid warna dasar');
      return false;
    }
    
    return true;
  };
  */

  const handleCSVSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    setLoading(true);
    setUploadProgress(0);

    try {
      if (!file) {
        setError('Please select a CSV file');
        setLoading(false);
        return;
      }

      // Re-validate file before submission
      const validation = validateCSVFile(file);
      if (!validation.valid) {
        setError(validation.error);
        setLoading(false);
        return;
      }

      // Create FormData with 'csv' field name (must match backend multer configuration)
      const formData = new FormData();
      formData.append('csv', file); // Field name 'csv' matches backend expectation in gateway.js and prediction-service.js

      const response = await predictionAPI.submitCSV(formData, (progressEvent) => {
        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(progress);
      });
      
      if (!response.data || !response.data.success) {
        throw new Error(response.data?.message || 'Failed to process CSV file');
      }

      // Format the CSV response to display in the results table
      const csvResults = response.data.data.results || [];
      
      if (csvResults.length === 0) {
        throw new Error('No valid predictions found in CSV');
      }

      // Convert CSV results to the format expected by renderResultsTable
      const formattedResults = csvResults.map(result => ({
        input: normalizeKeysToLowerCase(result.row), // Normalize lowercase keys to camelCase
        prediction: result.prediction === 'Batu Ginjal' ? 1 : 0, // Updated to check Indonesian terms
        penyakit: result.prediction, // Store the Indonesian disease name directly
        predictionId: result.id,
        hydrationAnalysis: result.hydrationAnalysis  // Pass through hydration data from backend
      }));

      setResults({
        success: true,
        results: formattedResults,
        predictionId: csvResults[0].id,
        totalProcessed: response.data.data.total || csvResults.length
      });

      // Show success message with processing info
      const total = response.data.data.total || 0;
      const processed = response.data.data.processed || 0;
      const failed = response.data.data.failed || 0;
      
      if (failed > 0) {
        setError(`Processed ${processed} out of ${total} records successfully. ${failed} records failed.`);
      } else if (processed > 1) {
        setError(`Successfully processed all ${processed} records from CSV file.`);
      } else {
        setError(`Successfully processed ${processed} record from CSV file.`);
      }

      // Clear the file input and preview on success
      setFile(null);
      setCsvPreview(null);
      document.querySelector('input[type="file"]').value = '';
      
    } catch (err) {
      console.error('Prediction error:', err);
      
      // Enhanced error handling based on HTTP status codes
      let errorMessage = 'An error occurred during prediction';
      
      if (err.response) {
        const status = err.response.status;
        const data = err.response.data;
        
        switch (status) {
          case 400:
            // Validation error - show detailed message
            if (data.errors && Array.isArray(data.errors)) {
              const errorList = data.errors.map(e => `Row ${e.row}: ${e.message}`).join('; ');
              errorMessage = `Validation errors: ${errorList}`;
            } else if (data.message) {
              errorMessage = `Validation error: ${data.message}`;
            } else {
              errorMessage = 'The CSV file format is invalid. Please ensure it has the required columns: ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, warnaDasar';
            }
            break;
            
          case 413:
            // File too large
            errorMessage = 'File too large. Maximum file size is 10MB. Please reduce the number of rows or split into multiple files.';
            break;
            
          case 422:
            // Unprocessable entity - data validation
            errorMessage = data.message || 'The CSV contains invalid data. Please check the values in your file.';
            break;
            
          case 500:
            // Server error
            errorMessage = 'Server error occurred while processing your file. Please try again later or contact support.';
            break;
            
          case 503:
            // Service unavailable
            errorMessage = 'The prediction service is temporarily unavailable. Please try again in a few moments.';
            break;
            
          default:
            errorMessage = data.message || err.message || errorMessage;
        }
      } else if (err.message) {
        // Network or other errors
        if (err.message.includes('timeout')) {
          errorMessage = 'Request timed out. The file may be too large or the server is not responding.';
        } else if (err.message.includes('Network Error')) {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        } else {
          errorMessage = err.message;
        }
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  // HAPUS SAYA - handleValuesSubmit function (lines 535-586) - DUPLICATE 1
  /*
  const handleValuesSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    setLoading(true);

    try {
      // Validate input
      if (!validateSingleRecord()) {
        setLoading(false);
        return;
      }

      // Convert all values to numbers
      const data = {};
      Object.keys(singleRecord).forEach(key => {
        data[key] = Number(singleRecord[key]);
      });

      // Add model ID
      data.modelId = model?.id || 'kidney_stone_model';

      const response = await predictionAPI.submitValues({ parameters: data });
      console.log('Prediction response:', response);

      // Check if we have a valid response with prediction data
      if (!response.data || !response.data.data) {
        throw new Error('Invalid response from prediction service');
      }

      // Format the response to display in the results table
      setResults({
        success: true,
        results: [{
          input: data,
          prediction: response.data.data.penyakit === 'Batu Ginjal' ? 1 : 0,
          penyakit: response.data.data.penyakit,
          predictionId: response.data.data.id || response.data.data._id || response.data.data.userSpecificId
        }],
        predictionId: response.data.data.id || response.data.data._id || response.data.data.userSpecificId
      });
    } catch (err) {
      console.error('Prediction error:', err);
      setError(
        err.response?.data?.message ||
          err.message ||
          'An error occurred during prediction'
      );
    } finally {
      setLoading(false);
    }
  };
  */

  // HAPUS SAYA - handleValuesSubmit function (lines 535-586)
  /*
  const handleValuesSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    setLoading(true);

    try {
      // Validate input
      if (!validateSingleRecord()) {
        setLoading(false);
        return;
      }

      // Convert all values to numbers
      const data = {};
      Object.keys(singleRecord).forEach(key => {
        data[key] = Number(singleRecord[key]);
      });

      // Add model ID
      data.modelId = model?.id || 'kidney_stone_model';

      const response = await predictionAPI.submitValues({ parameters: data });
      console.log('Prediction response:', response);

      // Check if we have a valid response with prediction data
      if (!response.data || !response.data.data) {
        throw new Error('Invalid response from prediction service');
      }

      // Format the response to display in the results table
      setResults({
        success: true,
        results: [{
          input: data,
          prediction: response.data.data.penyakit === 'Batu Ginjal' ? 1 : 0,
          penyakit: response.data.data.penyakit,
          predictionId: response.data.data.id || response.data.data._id || response.data.data.userSpecificId
        }],
        predictionId: response.data.data.id || response.data.data._id || response.data.data.userSpecificId
      });
    } catch (err) {
      console.error('Prediction error:', err);
      setError(
        err.response?.data?.message ||
          err.message ||
          'An error occurred during prediction'
      );
    } finally {
      setLoading(false);
    }
  };
  */

  const renderModelStatus = () => {
    if (loadingModelInfo) {
      return <Alert variant="info">Loading kidney stone prediction model...</Alert>;
    }

    if (!model) {
      return (
        <Alert variant="warning">
          <i className="fas fa-exclamation-triangle me-2"></i>
          The kidney_stone_model.joblib model is not available. Please place the model file in the DATASET folder and contact an administrator.
        </Alert>
      );
    }

    return (
      <Alert variant="success">
        <i className="fas fa-check-circle me-2"></i>
        <strong>Model Available:</strong> {model.name} (v{model.version}) - Accuracy: {(model.accuracy * 100).toFixed(1)}%
        <p className="mb-0 mt-1"><small>{model.description}</small></p>
      </Alert>
    );
  };

  const renderResultsTable = () => {
    if (!results || !results.results || !results.results.length) return null;

    return (
      <div className="mt-4">
        <h5>Prediction Results</h5>
        <div className="table-responsive">
          <Table striped bordered hover>
            <thead>
              <tr>
                <th>pH</th>
                <th>TDS</th>
                <th>Specific Gravity</th>
                <th>Turbidity NTU</th>
                <th>RGB Color</th>
                <th>Turbidity Level</th>
                <th>Warna Dasar</th>
                <th>Prediction</th>
                <th>Penyakit</th>
                <th>Hydration Status</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((result, idx) => (
                <tr key={idx}>
                  <td>{result.input.ph}</td>
                  <td>{result.input.tds}</td>
                  <td>{result.input.specificGravity}</td>
                  <td>{result.input.turbidityNTU}</td>
                  <td>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        backgroundColor: `rgb(${result.input.red},${result.input.green},${result.input.blue})`,
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        display: 'inline-block'
                      }}
                      title={`RGB(${result.input.red},${result.input.green},${result.input.blue})`}
                    />
                    <small className="ms-2">({result.input.red},{result.input.green},{result.input.blue})</small>
                  </td>
                  <td>{result.input.turbidityLevel}</td>
                  <td>{result.input.warnaDasar}</td>
                  <td className={Number(result.prediction) === 1 ? 'text-danger' : 'text-success'}>
                    <strong>{Number(result.prediction) === 1 ? 'Abnormal' : 'Normal'}</strong>
                  </td>
                  <td className={result.penyakit === 'Batu Ginjal' ? 'text-danger' : 'text-success'}>
                    <strong>{result.penyakit || (Number(result.prediction) === 1 ? 'Batu Ginjal' : 'Sehat')}</strong>
                  </td>
                  <td>
                    {result.hydrationAnalysis ? (
                      <div>
                        <Badge 
                          bg={result.hydrationAnalysis.needsWater ? (result.hydrationAnalysis.hydrationStatus === 'Dehydrated' ? 'warning' : 'info') : 'success'}
                          title={`Color Intensity: ${result.hydrationAnalysis.colorIntensity}, Yellow Ratio: ${result.hydrationAnalysis.yellowRatio}`}
                        >
                          {result.hydrationAnalysis.hydrationStatus}
                        </Badge>
                        {result.hydrationAnalysis.needsWater && (
                          <div className="small text-muted mt-1">
                            <i className="fas fa-tint me-1"></i>
                            {result.hydrationAnalysis.recommendation}
                          </div>
                        )}
                      </div>
                    ) : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <Alert variant="success">
          <i className="fas fa-check-circle me-2"></i>
          This prediction has been successfully saved to the database. You can view all your predictions in the History section.
        </Alert>
      </div>
    );
  };

  return (
    <div className="row">
      <div className="col-md-12">
        <h2>Kidney Stone Prediction</h2>
        
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError('')}>
            <i className="fas fa-exclamation-circle me-2"></i>
            {error}
          </Alert>
        )}
        
        {renderModelStatus()}

        <Card>
          <Card.Header>
            <Nav variant="tabs" className="card-header-tabs">
              {/* HAPUS SAYA - Manual Input Tab (lines 697-705) */}
              {/*
              <Nav.Item>
                <Nav.Link 
                  className={activeTab === 'manual' ? 'active' : ''} 
                  onClick={() => setActiveTab('manual')}
                >
                  <i className="fas fa-keyboard me-2"></i>
                  Manual Input
                </Nav.Link>
              </Nav.Item>
              */}
              <Nav.Item>
                <Nav.Link 
                  className={activeTab === 'csv' ? 'active' : ''} 
                  onClick={() => setActiveTab('csv')}
                >
                  <i className="fas fa-file-csv me-2"></i>
                  Upload CSV
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  className={activeTab === 'auto' ? 'active' : ''} 
                  onClick={() => setActiveTab('auto')}
                >
                  <i className="fas fa-robot me-2"></i>
                  Auto Data
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </Card.Header>
          <Card.Body>
            {/* HAPUS SAYA - Manual Input Form JSX (lines 798-985) */}
            {/*
            {activeTab === 'manual' ? (
              <Form onSubmit={handleValuesSubmit}>
                <h6 className="form-section-title mb-3">Core Urine Parameters</h6>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>pH:</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        min="4.5"
                        max="8.0"
                        name="ph"
                        value={singleRecord.ph}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 5.0-7.0</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>TDS (Total Dissolved Solids):</Form.Label>
                      <Form.Control
                        type="number"
                        step="10"
                        min="0"
                        max="2000"
                        name="tds"
                        value={singleRecord.tds}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 500-1500 ppm</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Specific Gravity:</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.001"
                        min="1.005"
                        max="1.030"
                        name="specificGravity"
                        value={singleRecord.specificGravity}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 1.005-1.030</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Turbidity (NTU):</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        name="turbidityNTU"
                        value={singleRecord.turbidityNTU}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 0-10 NTU (clear urine)</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>

                <h6 className="form-section-title mb-3 mt-4">Categorical Parameters</h6>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Turbidity Level:</Form.Label>
                      <Form.Select
                        name="turbidityLevel"
                        value={singleRecord.turbidityLevel}
                        onChange={handleInputChange}
                        required
                      >
                        <option value="Jernih">Jernih (Clear)</option>
                        <option value="Agak Keruh">Agak Keruh (Slightly Turbid)</option>
                        <option value="Keruh">Keruh (Turbid)</option>
                      </Form.Select>
                      <Form.Text className="text-muted">Visual assessment of urine clarity</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Warna Dasar (Base Color):</Form.Label>
                      <Form.Select
                        name="warnaDasar"
                        value={singleRecord.warnaDasar}
                        onChange={handleInputChange}
                        required
                      >
                        <option value="BENING">BENING (Clear)</option>
                        <option value="KUNING">KUNING (Yellow)</option>
                        <option value="MERAH">MERAH (Red)</option>
                        <option value="COKLAT">COKLAT (Brown)</option>
                        <option value="ORANGE">ORANGE (Orange)</option>
                        <option value="HIJAU">HIJAU (Green)</option>
                        <option value="BIRU">BIRU (Blue)</option>
                      </Form.Select>
                      <Form.Text className="text-muted">Base color category of urine</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>

                <h6 className="form-section-title mb-3 mt-4">RGB Color Values</h6>
                <div className="rgb-sliders-container">
                  <Row>
                    <Col md={8}>
                      <div className="rgb-slider-group">
                        <div className="rgb-slider-label">
                          <span>Red:</span>
                          <Badge bg="danger" className="rgb-value-badge">{singleRecord.red}</Badge>
                        </div>
                        <Form.Range
                          min="0"
                          max="255"
                          step="1"
                          name="red"
                          value={singleRecord.red}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="rgb-slider-group">
                        <div className="rgb-slider-label">
                          <span>Green:</span>
                          <Badge bg="success" className="rgb-value-badge">{singleRecord.green}</Badge>
                        </div>
                        <Form.Range
                          min="0"
                          max="255"
                          step="1"
                          name="green"
                          value={singleRecord.green}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="rgb-slider-group">
                        <div className="rgb-slider-label">
                          <span>Blue:</span>
                          <Badge bg="primary" className="rgb-value-badge">{singleRecord.blue}</Badge>
                        </div>
                        <Form.Range
                          min="0"
                          max="255"
                          step="1"
                          name="blue"
                          value={singleRecord.blue}
                          onChange={handleInputChange}
                        />
                      </div>
                    </Col>
                    <Col md={4} className="d-flex flex-column align-items-center justify-content-center">
                      <div
                        className="rgb-color-preview"
                        style={{
                          backgroundColor: `rgb(${singleRecord.red},${singleRecord.green},${singleRecord.blue})`
                        }}
                      />
                      <div className="rgb-color-preview-label">Color Preview</div>
                    </Col>
                  </Row>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-100 mt-4"
                  disabled={loading || !model}
                >
                  {loading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-calculator me-2"></i>
                      Generate Prediction
                    </>
                  )}
                </Button>
              </Form>
            ) : activeTab === 'csv' ? (
            */}
            {/* END HAPUS SAYA - Manual Input Form */}
            
            {activeTab === 'csv' ? (
              <Form onSubmit={handleCSVSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Upload CSV with Urine Parameters:</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    disabled={loading}
                    required
                  />
                  <Form.Text className="text-muted">
                    Your CSV file should contain columns for ph, tds, specificGravity, turbidityNTU, red, green, blue, turbidityLevel, and warnaDasar. Maximum file size: 10MB.
                  </Form.Text>
                </Form.Group>
                
                {/* CSV Preview Section */}
                {csvPreview && (
                  <Alert variant="success" className="mb-3">
                    <h6><i className="fas fa-check-circle me-2"></i>CSV File Validated</h6>
                    <p className="mb-2"><strong>Delimiter:</strong> {csvPreview.delimiter === ',' ? 'Comma (,)' : 'Semicolon (;)'}</p>
                    <p className="mb-2"><strong>Total rows to process:</strong> {csvPreview.totalRows}</p>
                    <p className="mb-2"><strong>Preview of first {csvPreview.previewRows.length} rows:</strong></p>
                    <div className="table-responsive">
                      <Table size="sm" bordered>
                        <thead>
                          <tr>
                            <th>pH</th>
                            <th>TDS</th>
                            <th>SG</th>
                            <th>NTU</th>
                            <th>R</th>
                            <th>G</th>
                            <th>B</th>
                            <th>Turbidity</th>
                            <th>Warna</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.previewRows.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.ph}</td>
                              <td>{row.tds}</td>
                              <td>{row.specificGravity}</td>
                              <td>{row.turbidityNTU}</td>
                              <td>{row.red}</td>
                              <td>{row.green}</td>
                              <td>{row.blue}</td>
                              <td>{row.turbidityLevel}</td>
                              <td>{row.warnaDasar}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                    {csvPreview.totalRows > 3 && (
                      <small className="text-muted">... and {csvPreview.totalRows - 3} more rows</small>
                    )}
                  </Alert>
                )}
                
                <Alert variant="info">
                  <i className="fas fa-info-circle me-2"></i>
                  <strong>CSV Format:</strong> Your file should have headers in the first row. Supports comma or semicolon delimiters (e.g., <code>ph,tds,specificGravity</code> or <code>ph;tds;specificGravity</code>).
                  <br/>
                  <strong>Example:</strong> <a href="/sample-urine-data.csv" download><i className="fas fa-download me-1"></i>Download Sample CSV Template</a>
                </Alert>
                
                {/* Upload Progress Bar */}
                {loading && uploadProgress > 0 && (
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>Uploading...</small>
                      <small>{uploadProgress}%</small>
                    </div>
                    <div className="progress">
                      <div 
                        className="progress-bar progress-bar-striped progress-bar-animated" 
                        role="progressbar" 
                        style={{ width: `${uploadProgress}%` }}
                        aria-valuenow={uploadProgress} 
                        aria-valuemin="0" 
                        aria-valuemax="100"
                      ></div>
                    </div>
                  </div>
                )}
                
                <Button
                  type="submit"
                  variant="primary"
                  className="w-100"
                  disabled={loading || !file || !model}
                >
                  {loading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Processing CSV... {uploadProgress > 0 ? `${uploadProgress}%` : ''}
                    </>
                  ) : (
                    <>
                      <i className="fas fa-file-csv me-2"></i>
                      Process CSV Data{csvPreview ? ` (${csvPreview.totalRows} rows)` : ''}
                    </>
                  )}
                </Button>
              </Form>
            ) : (
              // Auto Data Tab Content
              <div className="auto-data-container">
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="mb-0">Automatic Device Data</h5>
                  <Button 
                    variant="outline-primary" 
                    size="sm"
                    onClick={fetchAutoData}
                    disabled={loadingAutoData}
                  >
                    {loadingAutoData ? (
                      <><Spinner animation="border" size="sm" /> Refreshing...</>
                    ) : (
                      <><i className="fas fa-sync-alt me-2"></i>Refresh</>
                    )}
                  </Button>
                </div>
                
                {autoDataError && (
                  <Alert variant="warning">
                    <i className="fas fa-exclamation-triangle me-2"></i>
                    {autoDataError}
                  </Alert>
                )}
                
                {loadingAutoData ? (
                  <div className="text-center p-5">
                    <Spinner animation="border" />
                    <p className="mt-3">Loading automatic device data...</p>
                  </div>
                ) : autoData.length > 0 ? (
                  <div className="table-responsive">
                    <Table striped bordered hover>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Parameter</th>
                          <th>Value</th>
                          <th>Unit</th>
                          <th>Device ID</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {autoData.map((data) => (
                          <React.Fragment key={data._id}>
                            <tr>
                              <td rowSpan="9">{formatDate(data.timestamp)}</td>
                              <td>pH</td>
                              <td>{data.ph?.value?.toFixed(1) || 'N/A'}</td>
                              <td>{data.ph?.unit || '-'}</td>
                              <td rowSpan="9">{data.deviceId || data.userId || 'N/A'}</td>
                              <td rowSpan="9">
                                {data.processed ? (
                                  data.predictionResult === 1 ? (
                                    <Badge bg="danger">Abnormal</Badge>
                                  ) : (
                                    <Badge bg="success">Normal</Badge>
                                  )
                                ) : (
                                  <Badge bg="secondary">Not Processed</Badge>
                                )}
                              </td>
                            </tr>
                            <tr>
                              <td>TDS</td>
                              <td>{data.tds?.value || 'N/A'}</td>
                              <td>{data.tds?.unit || 'ppm'}</td>
                            </tr>
                            <tr>
                              <td>Specific Gravity</td>
                              <td>{data.specificGravity?.value?.toFixed(3) || 'N/A'}</td>
                              <td>{data.specificGravity?.unit || '-'}</td>
                            </tr>
                            <tr>
                              <td>Turbidity NTU</td>
                              <td>{data.turbidityNTU?.value?.toFixed(1) || 'N/A'}</td>
                              <td>{data.turbidityNTU?.unit || 'NTU'}</td>
                            </tr>
                            <tr>
                              <td>Red (RGB)</td>
                              <td>{data.red?.value !== undefined ? data.red.value : 'N/A'}</td>
                              <td>{data.red?.unit || '-'}</td>
                            </tr>
                            <tr>
                              <td>Green (RGB)</td>
                              <td>{data.green?.value !== undefined ? data.green.value : 'N/A'}</td>
                              <td>{data.green?.unit || '-'}</td>
                            </tr>
                            <tr>
                              <td>Blue (RGB)</td>
                              <td>
                                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                  {data.blue?.value !== undefined ? data.blue.value : 'N/A'}
                                  {(data.red?.value !== undefined && data.green?.value !== undefined && data.blue?.value !== undefined) && (
                                    <div
                                      style={{
                                        width: 20,
                                        height: 20,
                                        backgroundColor: `rgb(${data.red.value},${data.green.value},${data.blue.value})`,
                                        border: '1px solid #ccc',
                                        borderRadius: '4px',
                                        display: 'inline-block'
                                      }}
                                      title={`RGB(${data.red.value},${data.green.value},${data.blue.value})`}
                                    />
                                  )}
                                </div>
                              </td>
                              <td>{data.blue?.unit || '-'}</td>
                            </tr>
                            <tr>
                              <td>Turbidity Level</td>
                              <td colSpan="2">{data.turbidityLevel || 'N/A'}</td>
                            </tr>
                            <tr>
                              <td>Warna Dasar</td>
                              <td colSpan="2">{data.warnaDasar || 'N/A'}</td>
                            </tr>
                          </React.Fragment>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : (
                  <Alert variant="info">
                    <i className="fas fa-info-circle me-2"></i>
                    No automatic data available yet. When IoT devices upload measurements, they will appear here.
                  </Alert>
                )}
                
                <div className="mt-4">
                  <Alert variant="info">
                    <h5><i className="fas fa-info-circle me-2"></i>About Automatic Data</h5>
                    <p>This tab displays data automatically uploaded from compatible IoT devices. Each entry contains a complete set of measurements needed for prediction.</p>
                    <p className="mb-0"><strong>Device API:</strong> To upload data from your device, send a POST request to <code>/api/ml/autoupload</code> with your device token in the header.</p>
                  </Alert>
                </div>
              </div>
            )}

            {renderResultsTable()}
          </Card.Body>
        </Card>
      </div>
    </div>
  );
};

export default MLPrediction; 