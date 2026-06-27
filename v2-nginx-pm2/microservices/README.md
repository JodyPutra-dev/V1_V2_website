# Microservices Architecture

This directory contains the microservices for the Urine Disease Detection System:

## Services

1. **Gateway Service** (`gateway/gateway.js`): Main API gateway that routes requests to the appropriate service.
2. **User Service** (`user/user-service.js`): Handles user authentication, registration, and profile management.
3. **ML Service** (`ml/ml-service.js`): Processes urine parameters and provides disease predictions.
4. **MongoDB Service** (`db/mongo-service.js`): Shared MongoDB connection service used by all microservices.

## Setup and Running with PM2

The services are configured to run with PM2 using the `ecosystem.config.js` file in the root directory.

To start all services:

```bash
pm2 start ecosystem.config.js
```

To monitor services:

```bash
pm2 monit
```

To restart services:

```bash
pm2 restart ecosystem.config.js
```

## Database

All services connect to MongoDB using the shared MongoDB connection service located at `db/mongo-service.js`. This ensures consistent database connections across all services with proper error handling and reconnection capabilities.

The MongoDB database used is:
- Name: `urine-disease-detection`
- Default connection string: `mongodb://localhost:27017/urine-disease-detection`

The MongoDB service is configured to run as both:
1. A shared module imported by other services
2. A standalone service managed by PM2 that ensures the database connection is available

## Frontend

The React frontend is served statically using NGINX as configured in the `urine-disease-detection.conf` file in the root directory.

## Services

### Gateway (`/gateway`)
- Main entry point for the application
- Handles API routing and proxying to other services
- Serves the frontend static files
- Runs on port 7763

### ML Service (`/ml`)
- Handles machine learning predictions
- Manages ML models and datasets
- Runs on port 3002

### User Service (`/user`)
- Manages user authentication and profiles
- Handles user registration, login, and profile updates
- Runs on port 3001

### MongoDB Service (`/db`)
- Manages MongoDB connections for all services
- Provides connection pooling and error handling
- Handles automatic reconnection if the database connection is lost

## Starting the Services

All services are managed using PM2. To start all services:

```bash
pm2 start ecosystem.config.js
```

To start a specific service:

```bash
pm2 start ecosystem.config.js --only gateway
```

## Environment Variables

Environment variables are configured in `ecosystem.config.js`. The main variables are:

- `PORT`: The port each service runs on
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret for JWT authentication
- `NODE_ENV`: Environment (development/production)

## Directory Structure

```
microservices/
├── db/
│   └── mongo-service.js
├── gateway/
│   └── gateway.js
├── ml/
│   ├── ml-service.js
│   └── python_bridge.py
├── user/
│   └── user-service.js
└── README.md
```

## Shared Resources

All services connect to the same MongoDB database but use different collections. Shared directories:

- `uploads/`: Uploaded files
- `models/`: ML model files
- `datasets/`: Dataset files 