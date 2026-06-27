import React, { useState, useEffect } from 'react';
import { predictionAPI } from '../services/api';
import config from '../config';

const SimpleTest = () => {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const testConnections = async () => {
      try {
        setLoading(true);
        const connectionResults = await predictionAPI.testConnection();
        setResults(connectionResults);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    testConnections();
  }, []);

  const renderServiceStatus = (service, data) => {
    if (!data) return <span className="text-warning">Unknown</span>;
    if (data.error) return <span className="text-danger">Error: {data.error}</span>;
    return <span className="text-success">OK (Status: {data.status})</span>;
  };

  const renderApiTest = (test) => {
    if (!test) return null;
    return (
      <div className="card mb-2">
        <div className="card-body">
          <h6 className="card-subtitle mb-2">
            {test.endpoint}
            {test.success ? 
              <span className="badge bg-success float-end">Success</span> : 
              <span className="badge bg-danger float-end">Failed</span>
            }
          </h6>
          {test.status && <p className="card-text">Status: {test.status}</p>}
          {test.error && <p className="card-text text-danger">Error: {test.error}</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="container mt-4">
      <h1 className="mb-4">Microservices Connectivity Test</h1>
      
      {loading ? (
        <div className="alert alert-info">Testing connections to microservices...</div>
      ) : error ? (
        <div className="alert alert-danger">{error}</div>
      ) : (
        <div className="row">
          <div className="col-md-6">
            <div className="card mb-4">
              <div className="card-header">
                <h5 className="mb-0">Configuration</h5>
              </div>
              <div className="card-body">
                <p><strong>API URL:</strong> {config.apiUrl}</p>
                <p><strong>Gateway Service:</strong> {config.services.gateway}</p>
                <p><strong>ML Service:</strong> {config.services.mlService}</p>
                <p><strong>User Service:</strong> {config.services.userService}</p>
              </div>
            </div>

            <div className="card mb-4">
              <div className="card-header">
                <h5 className="mb-0">Service Status</h5>
              </div>
              <div className="card-body">
                <p><strong>Gateway:</strong> {renderServiceStatus('gateway', results.services?.gateway)}</p>
                <p><strong>Timestamp:</strong> {results.timestamp || 'N/A'}</p>
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <div className="card mb-4">
              <div className="card-header">
                <h5 className="mb-0">API Endpoint Tests</h5>
              </div>
              <div className="card-body">
                {results.apiTests?.length > 0 ? (
                  results.apiTests.map((test, index) => (
                    <div key={index}>{renderApiTest(test)}</div>
                  ))
                ) : (
                  <p>No API tests were performed</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleTest; 