/**
 * PM2 Configuration for NGINX+PM2 Production Deployment with Clustering
 * 
 * Architecture:
 *   NGINX Reverse Proxy (SSL, compression, rate limiting, load balancing)
 *   → PM2 Clustered Instances (process management, zero-downtime reload)
 *   → MongoDB (data persistence)
 * 
 * Instance Counts (Optimized for 2vCPU/4GB Server):
 *   - Gateway: 2 instances (high traffic, stateless proxying)
 *   - User: 2 instances (medium traffic, authentication)
 *   - Prediction: 2 instances (high traffic, ML predictions)
 *   - ML: 2 instances (CPU-intensive, model loading)
 *   - Admin: 1 instance (low traffic, admin-only)
 *   Total: 9 instances
 * 
 * Resource Allocation:
 *   - Total Memory: ~3.5GB (2×512MB + 2×256MB + 1×256MB + 2×512MB + 2×384MB)
 *   - Optimized for: 2vCPU, 4GB RAM server
 *   - Instance distribution: 4-5 instances per core
 * 
 * NGINX Configuration:
 *   NGINX will load balance across instances using upstream blocks.
 *   Configure upstream blocks in /etc/nginx/sites-available/urine-disease-detection.conf:
 *     upstream gateway_backend {
 *       server 127.0.0.1:7764;
 *       server 127.0.0.1:7765;
 *     }
 *     upstream user_backend {
 *       server 127.0.0.1:3001;
 *       server 127.0.0.1:3002;
 *     }
 *     upstream prediction_backend {
 *       server 127.0.0.1:3004;
 *       server 127.0.0.1:3005;
 *     }
 *     upstream ml_backend {
 *       server 127.0.0.1:3002;
 *       server 127.0.0.1:3003;
 *     }
 * 
 * PM2 Cluster Mode Features:
 *   - Automatic Port Increment: PM2 assigns PORT + instance_index (7764, 7765)
 *   - Built-in Load Balancing: Round-robin by default
 *   - Zero-Downtime Reload: pm2 reload ecosystem.config.nginx.js
 *   - Instance Management: pm2 list, pm2 logs, pm2 monit
 *   - Auto-Restart: Crashed instances automatically restart
 *   - Memory Limits: Instances restart when exceeding max_memory_restart
 * 
 * Usage:
 *   Start:   pm2 start ecosystem.config.nginx.js
 *   Reload:  pm2 reload ecosystem.config.nginx.js  (zero-downtime)
 *   Stop:    pm2 stop ecosystem.config.nginx.js
 *   Logs:    pm2 logs
 *   Monitor: pm2 monit
 *   Save:    pm2 save  (persist process list)
 *   Startup: pm2 startup  (auto-start on boot)
 * 
 * Log Rotation Setup:
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 20M
 *   pm2 set pm2-logrotate:retain 14
 *   pm2 set pm2-logrotate:compress true
 */

module.exports = {
  apps: [
    // ============================================
    // Gateway Service (2 instances)
    // ============================================
    {
      name: 'urine-gateway-nginx',
      script: './microservices/gateway/gateway.js',
      instances: 2,
      exec_mode: 'fork',
      increment_var: 'PORT',  // PM2 auto-increments PORT for each fork instance (7764, 7765)
      env: {
        NODE_ENV: 'production',
        PORT: 7764,
        DISABLE_HTTPS: 'true',  // NGINX handles SSL — Node.js stays on plain HTTP internally
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        USER_SERVICE_PORT: process.env.USER_SERVICE_PORT || 3001,
        ADMIN_SERVICE_PORT: process.env.ADMIN_SERVICE_PORT || 3003,
        ML_SERVICE_PORT: process.env.ML_SERVICE_PORT || 3002,
        PREDICTION_SERVICE_PORT: process.env.PREDICTION_SERVICE_PORT || 3004,
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://admin:12345678@127.0.0.1:27017/urine-disease-detection?directConnection=true&authSource=admin',
        JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production',
        DISABLE_REQUEST_QUEUE: process.env.DISABLE_REQUEST_QUEUE || 'false',
        DEPLOYMENT_VERSION: 'V2-NGINX-PM2-OPTIMIZED'
      },
      max_memory_restart: '512M',
      listen_timeout: 10000,
      kill_timeout: 30000,
      wait_ready: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', 'tmp'],
      error_file: './logs/pm2-gateway-nginx-error.log',
      out_file: './logs/pm2-gateway-nginx-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      instance_var: 'INSTANCE_ID'
    },

    // ============================================
    // User Service (2 instances)
    // ============================================
    {
      name: 'urine-user-nginx',
      script: './microservices/user/user-service.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.USER_SERVICE_PORT || 3001,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://admin:12345678@127.0.0.1:27017/urine-disease-detection?directConnection=true&authSource=admin',
        JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production',
        DISABLE_REQUEST_QUEUE: process.env.DISABLE_REQUEST_QUEUE || 'false',
        DEPLOYMENT_VERSION: 'V2-NGINX-PM2-OPTIMIZED'
      },
      max_memory_restart: '256M',
      listen_timeout: 10000,
      kill_timeout: 30000,
      wait_ready: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', 'tmp'],
      error_file: './logs/pm2-user-nginx-error.log',
      out_file: './logs/pm2-user-nginx-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      instance_var: 'INSTANCE_ID'
    },

    // ============================================
    // Admin Service (1 instance - fork mode)
    // ============================================
    {
      name: 'urine-admin-nginx',
      script: './microservices/admin/admin-service.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.ADMIN_SERVICE_PORT || 3003,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://admin:12345678@127.0.0.1:27017/urine-disease-detection?directConnection=true&authSource=admin',
        JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production',
        EMAIL_HOST: process.env.EMAIL_HOST || 'smtp.gmail.com',
        EMAIL_PORT: process.env.EMAIL_PORT || 587,
        EMAIL_USER: process.env.EMAIL_USER || '',
        EMAIL_PASS: process.env.EMAIL_PASS || '',
        DISABLE_REQUEST_QUEUE: process.env.DISABLE_REQUEST_QUEUE || 'false',
        DEPLOYMENT_VERSION: 'V2-NGINX-PM2-OPTIMIZED'
      },
      max_memory_restart: '256M',
      listen_timeout: 10000,
      kill_timeout: 30000,
      wait_ready: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', 'tmp', 'temp-exports'],
      error_file: './logs/pm2-admin-nginx-error.log',
      out_file: './logs/pm2-admin-nginx-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      instance_var: 'INSTANCE_ID'
    },

    // ============================================
    // ML Service (2 instances)
    // ============================================
    {
      name: 'urine-ml-nginx',
      script: './microservices/ml/ml-service.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.ML_SERVICE_PORT || 3002,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        PYTHON_PATH: process.env.PYTHON_PATH || '/usr/bin/python3',
        PYTHON_WORKER_POOL_SIZE: process.env.PYTHON_WORKER_POOL_SIZE || '1',  // 1 Python worker per cluster instance (2 total) — on 2-vCPU hardware, more workers = CPU contention, not more throughput
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://admin:12345678@127.0.0.1:27017/urine-disease-detection?directConnection=true&authSource=admin',
        JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production',
        DISABLE_REQUEST_QUEUE: process.env.DISABLE_REQUEST_QUEUE || 'false',
        DEPLOYMENT_VERSION: 'V2-NGINX-PM2-OPTIMIZED'
      },
      max_memory_restart: '512M',
      listen_timeout: 60000,
      kill_timeout: 30000,
      wait_ready: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', 'tmp', 'MODEL-ML'],
      error_file: './logs/pm2-ml-nginx-error.log',
      out_file: './logs/pm2-ml-nginx-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      instance_var: 'INSTANCE_ID'
    },

    // ============================================
    // Prediction Service (2 instances)
    // ============================================
    {
      name: 'urine-prediction-nginx',
      script: './microservices/prediction/prediction-service.js',
      instances: 2,
      exec_mode: 'cluster',  // cluster mode: both workers share port 3004; gateway's hardcoded localhost:3004 reaches both
      // increment_var removed: fork+increment_var split instances to 3004/3005, but gateway
      // hardcodes PREDICTION_SERVICE_PORT=3004, leaving 3005 permanently idle.
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PREDICTION_SERVICE_PORT || 3004,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        ML_SERVICE_URL: `http://127.0.0.1:${process.env.ML_SERVICE_PORT || 3002}`,
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://admin:12345678@127.0.0.1:27017/urine-disease-detection?directConnection=true&authSource=admin',
        JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production',
        DISABLE_REQUEST_QUEUE: process.env.DISABLE_REQUEST_QUEUE || 'false',
        DEPLOYMENT_VERSION: 'V2-NGINX-PM2-OPTIMIZED'
      },
      max_memory_restart: '384M',
      listen_timeout: 10000,
      kill_timeout: 30000,
      wait_ready: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', 'tmp', 'temp'],
      error_file: './logs/pm2-prediction-nginx-error.log',
      out_file: './logs/pm2-prediction-nginx-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      instance_var: 'INSTANCE_ID'
    }
  ]
};
