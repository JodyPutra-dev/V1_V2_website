import React, { useState, useEffect } from 'react';
import { Alert, Card, Table, Spinner, Form, Button, Nav, Row, Col, Badge } from 'react-bootstrap';
import { mlAPI, predictionAPI } from '../services/api';

const MLPrediction = () => {
  const [file, setFile] = useState(null);
  const [singleRecord, setSingleRecord] = useState({
    gravity: '',
    ph: '',
    osmo: '',
    cond: '',
    urea: '',
    calc: '',
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('manual'); // 'manual', 'csv', or 'auto'
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
        console.log('Model info response:', response.data);
        
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
        console.error('Error fetching models:', err);
        
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
          console.log('Setting fallback model for development mode');
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
      console.error('Error fetching auto data:', err);
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

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setSingleRecord({ ...singleRecord, [name]: value });
  };

  const validateSingleRecord = () => {
    // Check if all fields are filled
    const requiredFields = ['gravity', 'ph', 'osmo', 'cond', 'urea', 'calc'];
    for (const field of requiredFields) {
      if (!singleRecord[field]) {
        setError(`${field} is required`);
        return false;
      }

      // Check if all values are numbers
      if (isNaN(Number(singleRecord[field]))) {
        setError(`${field} must be a number`);
        return false;
      }
    }
    return true;
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

  const handleCSVSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    setLoading(true);

    try {
      if (!file) {
        setError('Please select a CSV file');
        setLoading(false);
        return;
      }

      if (!file.name.toLowerCase().endsWith('.csv')) {
        setError('Please upload a valid CSV file');
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append('csv', file);

      const response = await predictionAPI.submitCSV(formData);
      console.log('CSV prediction response:', response);
      
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

      // Clear the file input
      setFile(null);
      
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
          prediction: response.data.data.penyakit === 'Batu Ginjal' ? 1 : 0, // Updated to check Indonesian terms
          penyakit: response.data.data.penyakit, // Store the Indonesian disease name directly
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
                <th>Gravity</th>
                <th>pH</th>
                <th>Osmo</th>
                <th>Cond</th>
                <th>Urea</th>
                <th>Calc</th>
                <th>Prediction</th>
                <th>Penyakit</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((result, idx) => (
                <tr key={idx}>
                  <td>{result.input.gravity}</td>
                  <td>{result.input.ph}</td>
                  <td>{result.input.osmo}</td>
                  <td>{result.input.cond}</td>
                  <td>{result.input.urea}</td>
                  <td>{result.input.calc}</td>
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
              <Nav.Item>
                <Nav.Link 
                  className={activeTab === 'manual' ? 'active' : ''} 
                  onClick={() => setActiveTab('manual')}
                >
                  <i className="fas fa-keyboard me-2"></i>
                  Manual Input
                </Nav.Link>
              </Nav.Item>
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
            {activeTab === 'manual' ? (
              <Form onSubmit={handleValuesSubmit}>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Specific Gravity:</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.001"
                        min="1.001"
                        max="1.035"
                        name="gravity"
                        value={singleRecord.gravity}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 1.001-1.035</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>pH:</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        min="4.5"
                        max="9.0"
                        name="ph"
                        value={singleRecord.ph}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 4.5-9.0</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Osmolarity (mOsm):</Form.Label>
                      <Form.Control
                        type="number"
                        step="10"
                        min="150"
                        max="1200"
                        name="osmo"
                        value={singleRecord.osmo}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 300-900 mOsm</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Conductivity (mS/cm):</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        min="5"
                        max="40"
                        name="cond"
                        value={singleRecord.cond}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 15-30 mS/cm</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Urea (mmol/L):</Form.Label>
                      <Form.Control
                        type="number"
                        step="1"
                        min="20"
                        max="300"
                        name="urea"
                        value={singleRecord.urea}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 80-200 mmol/L</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Calcium (mmol/L):</Form.Label>
                      <Form.Control
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="15"
                        name="calc"
                        value={singleRecord.calc}
                        onChange={handleInputChange}
                        required
                      />
                      <Form.Text className="text-muted">Normal range: 2.5-8.0 mmol/L</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-100"
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
              <Form onSubmit={handleCSVSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Upload CSV with Urine Parameters:</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    required
                  />
                  <Form.Text className="text-muted">
                    Your CSV file should contain columns for gravity, ph, osmo, cond, urea, and calc.
                  </Form.Text>
                </Form.Group>
                <Alert variant="info">
                  <i className="fas fa-info-circle me-2"></i>
                  <strong>CSV Format:</strong> Your file should have headers in the first row.
                  <br />
                  <small>Example: gravity,ph,osmo,cond,urea,calc</small>
                  <br />
                  <small>1.015,6.2,500,20.5,150,7.2</small>
                </Alert>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-100"
                  disabled={loading || !file || !model}
                >
                  {loading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Processing CSV...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-file-csv me-2"></i>
                      Process CSV Data
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
                          <th>Measurement</th>
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
                              <td rowSpan="6">{formatDate(data.timestamp)}</td>
                              <td>Specific Gravity</td>
                              <td>{data.gravity.value.toFixed(3)}</td>
                              <td>{data.gravity.unit}</td>
                              <td rowSpan="6">{data.deviceId}</td>
                              <td rowSpan="6">
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
                              <td>pH</td>
                              <td>{data.ph.value.toFixed(1)}</td>
                              <td>{data.ph.unit}</td>
                            </tr>
                            <tr>
                              <td>Osmolarity</td>
                              <td>{data.osmo.value}</td>
                              <td>{data.osmo.unit}</td>
                            </tr>
                            <tr>
                              <td>Conductivity</td>
                              <td>{data.cond.value.toFixed(1)}</td>
                              <td>{data.cond.unit}</td>
                            </tr>
                            <tr>
                              <td>Urea</td>
                              <td>{data.urea.value}</td>
                              <td>{data.urea.unit}</td>
                            </tr>
                            <tr>
                              <td>Calcium</td>
                              <td>{data.calc.value.toFixed(1)}</td>
                              <td>{data.calc.unit}</td>
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