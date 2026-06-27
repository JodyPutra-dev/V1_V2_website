#!/bin/bash

# Parameter Migration Script for Dashboard N/A Fix
# This script runs fix-missing-csv-parameters.js to populate missing parameters in MongoDB

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/migration-$TIMESTAMP.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

echo "=================================================" | tee -a "$LOG_FILE"
echo "Parameter Migration Script" | tee -a "$LOG_FILE"
echo "Started at: $(date)" | tee -a "$LOG_FILE"
echo "=================================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check if MongoDB is accessible
echo -e "${YELLOW}[1/5] Checking MongoDB connection...${NC}" | tee -a "$LOG_FILE"
if mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ MongoDB is accessible${NC}" | tee -a "$LOG_FILE"
else
    echo -e "${RED}✗ MongoDB is not accessible${NC}" | tee -a "$LOG_FILE"
    echo "Please start MongoDB and try again." | tee -a "$LOG_FILE"
    exit 1
fi
echo "" | tee -a "$LOG_FILE"

# Check if migration script exists
if [ ! -f "$SCRIPT_DIR/fix-missing-csv-parameters.js" ]; then
    echo -e "${RED}✗ Migration script not found: fix-missing-csv-parameters.js${NC}" | tee -a "$LOG_FILE"
    exit 1
fi

# Run dry-run first
echo -e "${YELLOW}[2/5] Running migration in dry-run mode...${NC}" | tee -a "$LOG_FILE"
echo "This will show what would be updated without making changes." | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

node "$SCRIPT_DIR/fix-missing-csv-parameters.js" --dry-run 2>&1 | tee -a "$LOG_FILE"
DRY_RUN_EXIT_CODE=${PIPESTATUS[0]}

if [ $DRY_RUN_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}✗ Dry-run failed${NC}" | tee -a "$LOG_FILE"
    exit 1
fi

echo "" | tee -a "$LOG_FILE"

# Prompt for confirmation
echo -e "${YELLOW}[3/5] Review the dry-run results above.${NC}" | tee -a "$LOG_FILE"
read -p "Do you want to proceed with the actual migration? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}Migration cancelled by user.${NC}" | tee -a "$LOG_FILE"
    exit 0
fi

echo "" | tee -a "$LOG_FILE"

# Run actual migration
echo -e "${YELLOW}[4/5] Running actual migration...${NC}" | tee -a "$LOG_FILE"
node "$SCRIPT_DIR/fix-missing-csv-parameters.js" 2>&1 | tee -a "$LOG_FILE"
MIGRATION_EXIT_CODE=${PIPESTATUS[0]}

if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}✗ Migration failed${NC}" | tee -a "$LOG_FILE"
    exit 1
fi

echo "" | tee -a "$LOG_FILE"

# Verify results
echo -e "${YELLOW}[5/5] Verifying migration results...${NC}" | tee -a "$LOG_FILE"

# Count predictions with all 9 parameters
MONGO_QUERY='
db = db.getSiblingDB("urine-disease-detection");
const total = db.predictions.countDocuments();
const complete = db.predictions.countDocuments({
  "parameters.ph": { $exists: true },
  "parameters.tds": { $exists: true },
  "parameters.specificGravity": { $exists: true },
  "parameters.turbidityNTU": { $exists: true },
  "parameters.red": { $exists: true },
  "parameters.green": { $exists: true },
  "parameters.blue": { $exists: true },
  "parameters.turbidityLevel": { $exists: true },
  "parameters.warnaDasar": { $exists: true }
});
print("Total predictions: " + total);
print("Complete predictions (all 9 params): " + complete);
print("Incomplete predictions: " + (total - complete));
'

echo "Checking database..." | tee -a "$LOG_FILE"
mongosh --quiet --eval "$MONGO_QUERY" 2>&1 | tee -a "$LOG_FILE"

# Sample check - show one updated document
echo "" | tee -a "$LOG_FILE"
echo "Sample document (first prediction):" | tee -a "$LOG_FILE"
mongosh --quiet --eval 'db.getSiblingDB("urine-disease-detection").predictions.findOne({}, {parameters: 1, _id: 0})' 2>&1 | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "=================================================" | tee -a "$LOG_FILE"
echo -e "${GREEN}✓ Migration completed successfully!${NC}" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "=================================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Next steps:" | tee -a "$LOG_FILE"
echo "1. Restart services: ./stop.sh && ./start.sh" | tee -a "$LOG_FILE"
echo "2. Refresh Dashboard in browser (http://localhost:7764)" | tee -a "$LOG_FILE"
echo "3. Verify all 9 parameters display correctly (no N/A)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
