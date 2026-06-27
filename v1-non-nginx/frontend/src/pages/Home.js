import React from 'react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div className="row align-items-center">
      <div className="col-md-6">
        <h1>ML Microservices Platform</h1>
        <p className="lead">
          Access powerful machine learning models through our microservices architecture.
          Sign up to start making predictions with your data.
        </p>
        <div className="d-grid gap-2 d-md-flex justify-content-md-start">
          <Link to="/register" className="btn btn-primary btn-lg px-4 me-md-2">
            Get Started
          </Link>
          <Link to="/login" className="btn btn-outline-secondary btn-lg px-4">
            Login
          </Link>
        </div>
      </div>
      <div className="col-md-6">
        <div className="card">
          <div className="card-body">
            <h5 className="card-title">Our Services</h5>
            <ul className="list-group list-group-flush">
              <li className="list-group-item">Secure user authentication</li>
              <li className="list-group-item">Machine learning predictions</li>
              <li className="list-group-item">History tracking of all predictions</li>
              <li className="list-group-item">File and data upload capabilities</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home; 