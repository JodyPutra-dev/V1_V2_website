# ML/Python Logging Guide

## Overview
This guide explains the structured logging implementation for ML prediction and Python bridge operations in the Urine Disease Detection application.

### Log Files
1. **logs/app-%DATE%.log**: All application logs including ML/Python operations
2. **logs/error-%DATE%.log**: Error-level logs only
3. **logs/python_errors-%DATE%.log**: Python-specific errors (stderr, exit codes, module errors)
4. **logs/python_deps_install.log**: Python dependency installation output (from start.sh)

### Log Retention
- Application logs: 14 days
- Error logs: 14 days
- Python error logs: 30 days (longer retention for debugging)
- Dependency install logs: Persistent (not rotated)

## Request Correlation
All logs include request IDs for tracing requests across services:
- Format: `csv-{timestamp}-{random}` for CSV uploads
- Format: `req_{timestamp}_{random}` for other requests
- Request ID flows: Frontend → Gateway → Prediction Service → ML Service → Python Bridge

## Logging Functions

### logMLRequest(logger, requestData)
Logs ML service requests with parameters and context.

**Parameters:**
- `requestId`: Unique request identifier
- `model`: Model name (e.g., 'kidney_stone_model')
- `parameters`: Input parameters for prediction
- `endpoint`: ML service endpoint called

**Example:**
```javascript
logMLRequest(logger, {
  requestId: 'csv-1234567890-abc123',
  model: 'kidney_stone_model',
  parameters: { gravity: 1.015, ph: 6.2, osmo: 500, cond: 20.5, urea: 150, calc: 7.2 },
  endpoint: '/predict'
});
```

### logMLResponse(logger, responseData)
Logs ML service responses with status, duration, and full body on errors.

**Parameters:**
- `requestId`: Unique request identifier
- `status`: HTTP status code
- `duration`: Request duration in milliseconds
- `result`: Prediction result (if successful)
- `error`: Error message (if failed)
- `fullBody`: Full response body (logged only for errors)

**Example:**
```javascript
logMLResponse(logger, {
  requestId: 'csv-1234567890-abc123',
  status: 200,
  duration: 1250,
  result: 'Normal'
});
```

### logPythonExecution(logger, executionData)
Logs Python process spawn with arguments, model path, and input data.

**Parameters:**
- `requestId`: Unique request identifier
- `command`: Python command (e.g., 'python3')
- `args`: Array of command-line arguments
- `modelPath`: Path to ML model file
- `modelSize`: Model file size in bytes
- `inputPath`: Path to input JSON file
- `outputPath`: Path to output JSON file
- `inputSummary`: Summary of input parameters

**Example:**
```javascript
logPythonExecution(logger, {
  requestId: 'csv-1234567890-abc123',
  command: 'python3',
  args: ['python_bridge.py', '--model', '/path/to/model.joblib', '--input', '/tmp/input.json', '--output', '/tmp/output.json'],
  modelPath: '/var/www/html/HIBAH/MODEL-ML/joblib/kidney_stone_model.joblib',
  modelSize: 125672,
  inputPath: '/tmp/input_1234567890.json',
  outputPath: '/tmp/output_1234567890.json',
  inputSummary: 'gravity, ph, osmo, cond, urea, calc'
});
```

### logPythonError(logger, errorData)
Logs Python stderr, exit codes, and error context to python_errors.log.

**Parameters:**
- `requestId`: Unique request identifier
- `stderr`: Python stderr output
- `exitCode`: Process exit code
- `command`: Python command executed
- `context`: Additional context (model path, input/output paths)

**Example:**
```javascript
logPythonError(logger, {
  requestId: 'csv-1234567890-abc123',
  stderr: 'ModuleNotFoundError: No module named \'joblib\'',
  exitCode: 1,
  command: 'python3 python_bridge.py',
  context: { modelPath: '/var/www/html/HIBAH/MODEL-ML/joblib/kidney_stone_model.joblib' }
});
```

### logCSVProcessing(logger, processingData)
Logs CSV upload, validation, parsing, and row-by-row processing.

**Parameters:**
- `requestId`: Unique request identifier
- `stage`: Processing stage (e.g., 'upload_start', 'parsing_complete', 'processing_complete')
- `filename`: CSV filename
- `fileSize`: File size in bytes
- `rowCount`: Total rows parsed
- `validRows`: Number of valid rows
- `invalidRows`: Number of invalid rows
- `errors`: Array of validation/processing errors
- `successCount`: Number of successful predictions
- `failureCount`: Number of failed predictions
- `duration`: Processing duration in milliseconds

**Example:**
```javascript
logCSVProcessing(logger, {
  requestId: 'csv-1234567890-abc123',
  stage: 'processing_complete',
  filename: 'test.csv',
  fileSize: 2048,
  rowCount: 10,
  successCount: 9,
  failureCount: 1
});
```

## Error Codes
ML/Python-specific error codes in error-formatter.js:

| Error Code | Description | Typical Cause |
|------------|-------------|---------------|
| `ML_SERVICE_ERROR` | ML service returned error | ML service unavailable or misconfigured |
| `ML_PREDICTION_FAILED` | Prediction computation failed | Invalid input parameters or model issue |
| `PYTHON_PROCESS_ERROR` | Python process execution failed | Python not installed or script error |
| `PYTHON_MODULE_ERROR` | Python module import error | Missing dependencies (joblib, scikit-learn, etc.) |
| `MODEL_NOT_FOUND` | ML model file not found | MODEL-ML symlink broken or model deleted |
| `MODEL_LOAD_ERROR` | Failed to load ML model | Corrupted model file or incompatible version |
| `CSV_PARSE_ERROR` | CSV parsing failed | Malformed CSV file or wrong delimiter |
| `CSV_VALIDATION_ERROR` | CSV validation failed | Missing columns or invalid data types |

## Viewing Logs

### Real-time monitoring
```bash
# All logs
tail -f logs/app-$(date +%Y-%m-%d).log

# Python errors only
tail -f logs/python_errors-$(date +%Y-%m-%d).log

# Errors only
tail -f logs/error-$(date +%Y-%m-%d).log
```

### Search by request ID
```bash
grep "csv-1234567890-abc123" logs/app-*.log
```

### Filter ML operations
```bash
# ML service logs
grep "\[ml-service\]" logs/app-*.log

# Prediction service logs
grep "\[prediction-service\]" logs/app-*.log

# Gateway logs
grep "\[gateway\]" logs/app-*.log
```

### Python errors
```bash
# All Python errors
cat logs/python_errors-*.log

# Module errors (e.g., joblib not found)
grep "ModuleNotFoundError" logs/python_errors-*.log

# Model loading errors
grep "Model file" logs/python_errors-*.log

# Exit code errors
grep "exitCode" logs/python_errors-*.log
```

## Troubleshooting

### CSV Upload Fails

1. **Check gateway logs** for file upload issues:
   ```bash
   grep "csv-" logs/app-$(date +%Y-%m-%d).log | grep gateway
   ```

2. **Check prediction-service logs** for CSV parsing errors:
   ```bash
   grep "csv-" logs/app-$(date +%Y-%m-%d).log | grep prediction-service
   ```

3. **Check ML service logs** for prediction failures:
   ```bash
   grep "csv-" logs/app-$(date +%Y-%m-%d).log | grep ml-service
   ```

4. **Check python_errors.log** for Python execution issues:
   ```bash
   grep "csv-" logs/python_errors-$(date +%Y-%m-%d).log
   ```

### Python Module Errors

1. **Check dependency installation logs**:
   ```bash
   cat logs/python_deps_install.log
   cat logs/venv_setup.log  # Virtual environment setup log
   ```

2. **Verify virtual environment exists**:
   ```bash
   ls -la venv/
   ls -lh venv/bin/python
   ```

3. **Check installed packages (in venv)**:
   ```bash
   source venv/bin/activate
   pip list | grep -E "joblib|scikit-learn|numpy|pandas"
   deactivate
   ```

4. **Check python_errors.log for import errors**:
   ```bash
   grep "ModuleNotFoundError\|ImportError" logs/python_errors-*.log
   ```

5. **Manual reinstallation** (if needed):
   ```bash
   source venv/bin/activate
   pip install -r requirements.txt
   deactivate
   ```

6. **Check which Python executable is used**:
   ```bash
   grep "Using Python executable" logs/ml.log
   ```
   
   Should show: `Using Python executable: /var/www/html/HIBAH/deployments/v1-non-nginx/venv/bin/python`

### Model Not Found

1. **Check ML service logs** for model path verification:
   ```bash
   grep "Model file" logs/app-$(date +%Y-%m-%d).log
   ```

2. **Verify MODEL-ML symlink**:
   ```bash
   ls -la MODEL-ML
   readlink -f MODEL-ML
   ```

3. **Check model file exists**:
   ```bash
   ls -lh MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib
   ```

4. **Review start.sh output** for model verification:
   ```bash
   ./start.sh 2>&1 | grep -i model
   ```

### Prediction Failures

1. **Check error logs** for specific error messages:
   ```bash
   tail -n 100 logs/error-$(date +%Y-%m-%d).log
   ```

2. **Check Python process exit codes**:
   ```bash
   grep "exitCode" logs/python_errors-$(date +%Y-%m-%d).log
   ```

3. **Review full stderr output**:
   ```bash
   grep -A 10 "Python Process Error" logs/python_errors-*.log
   ```

4. **Test ML service directly**:
   ```bash
   curl -X POST http://localhost:3002/predict \
     -H "Content-Type: application/json" \
     -d '{"gravity":1.015,"ph":6.2,"osmo":500,"cond":20.5,"urea":150,"calc":7.2}'
   ```

## Log Format
All logs use structured JSON-like format:
```
2025-01-15 10:30:45 +0700 [INFO] [ml-service] Making prediction {"requestId":"req_123","model":"kidney_stone_model","parameters":{...}}
```

**Format Components:**
- **Timestamp**: `2025-01-15 10:30:45 +0700` (with timezone)
- **Level**: `[INFO]`, `[WARN]`, `[ERROR]`
- **Service**: `[ml-service]`, `[prediction-service]`, `[gateway]`
- **Message**: Human-readable message
- **Metadata**: JSON object with additional context

## Performance Considerations
- Logs are written asynchronously (non-blocking)
- Daily rotation prevents disk space issues
- Automatic compression of old logs (gzip)
- Sensitive data (passwords, tokens) automatically redacted

## Production Deployment

### Environment Variables
```bash
# Set production environment
export NODE_ENV=production

# Set log level (info, warn, error)
export LOG_LEVEL=info

# Enable debug mode (adds console logs)
export DEBUG=false
```

### Log Management
```bash
# Monitor log file sizes
du -sh logs/

# Archive old logs periodically
tar -czf logs-archive-$(date +%Y%m).tar.gz logs/*.gz

# Clean up archived logs (keep last 3 months)
find logs/ -name "*.gz" -mtime +90 -delete
```

### Log Rotation
Winston's DailyRotateFile automatically:
- Creates new log files daily
- Compresses old logs with gzip
- Deletes logs older than retention period
- Manages disk space automatically

### Disk Space Monitoring
```bash
# Check disk usage
df -h /var/www/html/HIBAH/deployments/v1-non-nginx/logs

# Alert if logs exceed 1GB
if [ $(du -s logs/ | cut -f1) -gt 1048576 ]; then
  echo "WARNING: Log directory exceeds 1GB"
fi
```

## Integration with Monitoring Tools

### Elasticsearch/Logstash/Kibana (ELK)
Configure Logstash to parse Winston logs:
```conf
input {
  file {
    path => "/var/www/html/HIBAH/deployments/v1-non-nginx/logs/app-*.log"
    type => "application"
  }
  file {
    path => "/var/www/html/HIBAH/deployments/v1-non-nginx/logs/python_errors-*.log"
    type => "python_error"
  }
}

filter {
  grok {
    match => { "message" => "%{TIMESTAMP_ISO8601:timestamp} \[%{LOGLEVEL:level}\] \[%{DATA:service}\] %{GREEDYDATA:log_message}" }
  }
  json {
    source => "log_message"
    target => "metadata"
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "urine-detection-%{+YYYY.MM.dd}"
  }
}
```

### Prometheus/Grafana
Expose log metrics via custom exporter:
```javascript
// Example: Count Python errors
const pythonErrorCount = new promClient.Counter({
  name: 'python_errors_total',
  help: 'Total number of Python execution errors',
  labelNames: ['error_code', 'model']
});
```

## Support
For additional help:
- Check `PYTHON_DEPS_SETUP.md` for Python dependency issues
- Check `README.md` for general setup and deployment
- Review service-specific logs in `logs/` directory
- Contact system administrator for production issues
