# Python Dependencies Setup Guide

## Overview

The ML prediction service requires Python dependencies (joblib, scikit-learn, numpy, pandas) to load and run the kidney stone prediction model. Without these packages, you'll see errors like:

```
ModuleNotFoundError: No module named 'joblib'
```

This document explains how dependencies are installed using **Python virtual environment (venv)**, how to verify installation, and how to troubleshoot issues.

## Why Virtual Environment?

Modern Python distributions (Python 3.11+) enforce **PEP 668** "externally-managed-environment" to prevent system package corruption. Direct `pip3 install` commands will fail with:

```
error: externally-managed-environment
× This environment is externally managed
```

**Solution:** We use a Python virtual environment (`venv/`) that:
- ✅ Isolates dependencies from system packages
- ✅ Requires no `sudo` privileges
- ✅ Allows safe package upgrades
- ✅ Follows Python best practices

## Automatic Installation

### Via start.sh Script

The `start.sh` script now automatically:

1. Creates a virtual environment in `venv/` directory (if doesn't exist)
2. Activates the virtual environment
3. Installs all dependencies from `requirements.txt` into venv
4. Uses `venv/bin/python` for all ML predictions

**What Gets Installed:**
- `joblib>=1.0.0` - Model serialization/deserialization
- `scikit-learn>=0.24.0` - ML framework
- `numpy>=1.19.0` - Array operations
- `pandas>=1.1.0` - Data manipulation

**Startup Output:**
```bash
Setting up Python virtual environment...
  Creating virtual environment: venv
✓ Virtual environment created
✓ Virtual environment activated

Installing Python dependencies...
  Running: pip install --quiet --upgrade -r requirements.txt
✓ Python dependencies installed successfully
  Installed: joblib, scikit-learn, numpy, pandas
```

## Manual Installation

### Using Virtual Environment (Recommended)

If automatic installation fails or you prefer manual control:

```bash
# Create virtual environment (first time only)
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install from requirements.txt
pip install -r requirements.txt

# Or install individually
pip install joblib>=1.0.0
pip install scikit-learn>=0.24.0
pip install numpy>=1.19.0
pip install pandas>=1.1.0

# Deactivate when done (optional)
deactivate
```

### System-Wide Installation (Not Recommended)

If you must install system-wide (requires `--break-system-packages` flag):

```bash
# WARNING: This may break your system Python
pip3 install --break-system-packages -r requirements.txt
```

**Not recommended** because:
- May conflict with system packages
- Can break system tools that depend on Python
- Violates PEP 668 safeguards

## Verification Steps

### 1. Check Virtual Environment

```bash
# Verify venv directory exists
ls -la venv/

# Check Python executable
ls -lh venv/bin/python
```

### 2. Test Package Imports (Inside venv)

```bash
# Activate venv first
source venv/bin/activate

# Test each package
python3 -c "import joblib; print('joblib:', joblib.__version__)"
python3 -c "import sklearn; print('scikit-learn:', sklearn.__version__)"
python3 -c "import numpy; print('numpy:', numpy.__version__)"
python3 -c "import pandas; print('pandas:', pandas.__version__)"

# Deactivate when done
deactivate
```

Expected output:
```
joblib: 1.3.2
scikit-learn: 1.3.0
numpy: 1.24.3
pandas: 2.0.3
```

### 3. Test Package Imports (System-wide, if using --break-system-packages)

```bash
# Test without activating venv
python3 -c "import joblib; print('joblib:', joblib.__version__)"
python3 -c "import sklearn; print('scikit-learn:', sklearn.__version__)"
python3 -c "import numpy; print('numpy:', numpy.__version__)"
python3 -c "import pandas; print('pandas:', pandas.__version__)"
```

### 4. Check ML Service Uses Venv Python

```bash
# Check which Python executable ML service will use
ls -lh venv/bin/python

# Verify the service detects venv Python
grep "Using Python executable" logs/ml.log
```

Expected log output:
```
Using Python executable: /var/www/html/HIBAH/deployments/v1-non-nginx/venv/bin/python
```

## Verification Steps (Legacy - Before venv)

### 1. Check Python Version

```bash
python3 --version
# Expected: Python 3.8.0 or higher
```

### 2. Verify pip3 Installation

```bash
pip3 --version
# Expected: pip 20.0 or higher from /usr/lib/python3.x/site-packages/pip
```

If pip3 is not found:
```bash
sudo apt-get update
sudo apt-get install python3-pip
```

### 3. Verify Package Installation

Check each required package (inside venv):

```bash
# Activate venv
source venv/bin/activate

# Check all packages
pip list | grep -E "joblib|scikit-learn|numpy|pandas"

# Or check individually
python3 -c "import joblib; print('joblib version:', joblib.__version__)"
python3 -c "import sklearn; print('scikit-learn version:', sklearn.__version__)"
python3 -c "import numpy; print('numpy version:', numpy.__version__)"
python3 -c "import pandas; print('pandas version:', pandas.__version__)"

deactivate
```

Expected output (versions may vary):
```
joblib version: 1.3.2
scikit-learn version: 1.3.0
numpy version: 1.24.3
pandas version: 2.0.3
```

### 4. Test python_bridge.py with Venv Python

Create test input file:
```bash
cat > /tmp/test_input.json << 'EOF'
{
  "gravity": 1.015,
  "ph": 5.5,
  "osmo": 500,
  "cond": 15,
  "urea": 200,
  "calc": 5
}
EOF
```

Run python_bridge.py using venv Python:
```bash
venv/bin/python microservices/ml/python_bridge.py \
  --model MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib \
  --input /tmp/test_input.json \
  --output /tmp/test_output.json

# Check output
cat /tmp/test_output.json
```

Expected output:
```json
{
  "predictedClass": 0,
  "result": [0.75, 0.25],
  "success": true
}
```

## Troubleshooting

### Issue 1: "externally-managed-environment" Error

**Symptom:**
```
error: externally-managed-environment
× This environment is externally managed
```

**Cause:** Python 3.11+ enforces PEP 668 to prevent system package corruption.

**Solution:** Use virtual environment (already implemented in start.sh)
```bash
# Manual fix:
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Issue 2: python3-venv Not Installed

**Symptom:**
```
The virtual environment was not created successfully
```

**Cause:** `python3-venv` package missing.

**Solution:**
```bash
sudo apt-get update
sudo apt-get install python3-venv
```

### Issue 3: pip3 Command Not Found (Legacy)

**Symptoms:**
```
bash: pip3: command not found
```

**Solution:**
```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install python3-pip

# RedHat/CentOS
sudo yum install python3-pip

# Verify installation
pip3 --version
```

### Issue 2: Permission Denied During Installation

**Symptoms:**
```
ERROR: Could not install packages due to an OSError: [Errno 13] Permission denied
```

**Solutions:**

Option 1: Use --user flag
```bash
pip3 install --user -r requirements.txt
```

Option 2: Use virtual environment (recommended)
```bash
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt
```

Option 3: Use sudo (not recommended for production)
```bash
sudo pip3 install -r requirements.txt
```

### Issue 3: Version Conflicts

**Symptoms:**
```
ERROR: pip's dependency resolver does not currently take into account all the packages that are installed
```

**Solution:**
```bash
# Upgrade pip first
pip3 install --upgrade pip

# Use specific versions if needed
pip3 install joblib==1.3.2 scikit-learn==1.3.0 numpy==1.24.3 pandas==2.0.3
```

### Issue 4: Import Errors After Installation

**Symptoms:**
```python
ModuleNotFoundError: No module named 'joblib'
```
But `pip3 list | grep joblib` shows it's installed.

**Solution:**

Check Python path mismatch:
```bash
# Check which Python is being used
which python3
python3 -c "import sys; print(sys.executable)"

# Check where pip3 installs packages
pip3 show joblib | grep Location

# Ensure they match
```

If they don't match, you may have multiple Python installations. Use the specific pip for your Python:
```bash
python3 -m pip install -r requirements.txt
```

### Issue 5: Model File Not Found

**Symptoms:**
```
FileNotFoundError: [Errno 2] No such file or directory: 'MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib'
```

**Solution:**

Check MODEL-ML symlink:
```bash
# Check if symlink exists
ls -la MODEL-ML

# If not found, create it
ln -s ../../MODEL-ML MODEL-ML

# Verify target exists
ls -la MODEL-ML/joblib/kidney_stone_model/

# Check model file
ls -lh MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib
```

## Testing ML Endpoint

### 1. Start Services

```bash
./start.sh
```

Check ML service is running:
```bash
curl http://localhost:3002/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "ml-service",
  "timestamp": "2025-11-23T08:45:00.000Z"
}
```

### 2. Test Single Prediction

```bash
curl -X POST http://localhost:3002/predict \
  -H "Content-Type: application/json" \
  -H "user-id: test-user-123" \
  -d '{
    "gravity": 1.015,
    "ph": 5.5,
    "osmo": 500,
    "cond": 15,
    "urea": 200,
    "calc": 5
  }'
```

Expected response:
```json
{
  "success": true,
  "result": [0.75, 0.25],
  "predictedClass": 0,
  "timestamp": "2025-11-23T08:45:00.000Z"
}
```

### 3. Test via Gateway

```bash
# Get auth token first
TOKEN=$(curl -X POST http://localhost:7764/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | jq -r '.token')

# Test prediction through gateway
curl -X POST http://localhost:7764/api/predict \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "parameters": {
      "gravity": 1.015,
      "ph": 5.5,
      "osmo": 500,
      "cond": 15,
      "urea": 200,
      "calc": 5
    }
  }'
```

## Testing CSV Upload

### 1. Create Test CSV File

**Comma Delimiter:**
```bash
cat > test.csv << 'EOF'
gravity,ph,osmo,cond,urea,calc
1.015,6.2,500,20.5,150,7.2
1.020,5.8,600,22.0,180,8.5
EOF
```

**Semicolon Delimiter:**
```bash
cat > test.csv << 'EOF'
gravity;ph;osmo;cond;urea;calc
1.015;6.2;500;20.5;150;7.2
1.020;5.8;600;22.0;180;8.5
EOF
```

### 2. Upload via Gateway

```bash
# Get auth token
TOKEN=$(curl -X POST http://localhost:7764/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | jq -r '.token')

# Upload CSV
curl -X POST http://localhost:7764/api/predict/csv \
  -H "Authorization: Bearer $TOKEN" \
  -F "csv=@test.csv"
```

Expected response:
```json
{
  "success": true,
  "data": {
    "total": 2,
    "processed": 2,
    "failed": 0,
    "results": [
      {
        "row": {"gravity": 1.015, "ph": 6.2, ...},
        "prediction": "Sehat",
        "id": "..."
      },
      {
        "row": {"gravity": 1.020, "ph": 5.8, ...},
        "prediction": "Batu Ginjal",
        "id": "..."
      }
    ],
    "errors": []
  }
}
```

### 3. Check Logs

```bash
# Check ML service logs
tail -f logs/ml.log

# Check prediction service logs
tail -f logs/prediction.log

# Check Python dependency installation logs
cat logs/python_deps_install.log
```

## Log Files

### Python Dependency Installation
- **File**: `logs/python_deps_install.log`
- **Contents**: pip3 installation output
- **When to check**: If dependency installation fails

### ML Service Logs
- **File**: `logs/ml.log`
- **Contents**: ML service startup, prediction requests, Python bridge output
- **Key patterns**:
  - `[ML-SERVICE] Starting ML service`
  - `[PYTHON-BRIDGE] Spawning Python process`
  - `[PYTHON-BRIDGE] Output: {...}`

### Prediction Service Logs
- **File**: `logs/prediction.log`
- **Contents**: Prediction service operations, CSV parsing
- **Key patterns**:
  - `[CSV] Detected semicolon delimiter`
  - `[CSV] Processing 1 rows`
  - `[CSV] Row 1: Successfully processed`

## Common Error Patterns

### Error: No module named 'joblib'
**Log Pattern:**
```
ModuleNotFoundError: No module named 'joblib'
```
**Fix**: Run `pip3 install -r requirements.txt`

### Error: Model file not found
**Log Pattern:**
```
FileNotFoundError: MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib
```
**Fix**: Create MODEL-ML symlink: `ln -s ../../MODEL-ML MODEL-ML`

### Error: No valid predictions found in CSV
**Log Pattern:**
```
[CSV] Processing 1 rows
[CSV] Row 1: ML service error
```
**Fix**: Check `logs/ml.log` for Python errors, likely missing dependencies

## Best Practices

1. **Use Virtual Environment** - Isolates dependencies, prevents conflicts
2. **Check Logs First** - Most issues are explained in log files
3. **Verify Each Step** - Test Python imports before starting services
4. **Keep Dependencies Updated** - Run `pip3 install --upgrade -r requirements.txt` periodically
5. **Document Custom Changes** - If you modify requirements.txt, document why

## Quick Diagnosis Script

Save as `diagnose_python.sh`:
```bash
#!/bin/bash
echo "=== Python Diagnosis ==="
echo "Python version: $(python3 --version 2>&1)"
echo "pip3 version: $(pip3 --version 2>&1)"
echo ""
echo "=== Checking Packages ==="
for pkg in joblib sklearn numpy pandas; do
  python3 -c "import $pkg; print(f'✓ $pkg: {$pkg.__version__}')" 2>&1 || echo "✗ $pkg: Not installed"
done
echo ""
echo "=== Checking Model ==="
ls -lh MODEL-ML/joblib/kidney_stone_model/kidney_stone_model.joblib 2>&1 || echo "✗ Model file not found"
echo ""
echo "=== Testing python_bridge.py ==="
python3 microservices/ml/python_bridge.py --help 2>&1 | head -5
```

Run with: `chmod +x diagnose_python.sh && ./diagnose_python.sh`

## Support

If issues persist:
1. Check `logs/python_deps_install.log` for installation errors
2. Check `logs/ml.log` for runtime errors
3. Verify MODEL-ML symlink with `ls -la MODEL-ML`
4. Test python_bridge.py directly with sample input
5. See README.md for general setup instructions
