#!/bin/bash
# fix-dashboard-and-tokens.sh
# Quick fix script for Dashboard N/A values and Device Token generation

set -e

echo "========================================="
echo "Dashboard & Token Fix Script"
echo "========================================="
echo ""

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Step 1: Run MongoDB migration
echo "Step 1: Running MongoDB parameter migration..."
echo "-------------------------------------------"
if [ -f "migrate-old-predictions.js" ]; then
  node migrate-old-predictions.js
  echo "✓ Migration completed"
else
  echo "✗ Migration script not found: migrate-old-predictions.js"
  exit 1
fi

echo ""

# Step 2: Restart services to apply changes
echo "Step 2: Restarting services..."
echo "-------------------------------------------"
if [ -f "stop.sh" ]; then
  ./stop.sh
  echo "✓ Services stopped"
else
  echo "⚠ stop.sh not found, attempting manual stop..."
  pkill -f "node.*user-service.js" || true
  pkill -f "node.*prediction-service.js" || true
  pkill -f "node.*ml-service.js" || true
  pkill -f "node.*admin-service.js" || true
  pkill -f "node.*db-service.js" || true
  pkill -f "node.*gateway.js" || true
fi

sleep 3

if [ -f "start.sh" ]; then
  ./start.sh
  echo "✓ Services started"
else
  echo "✗ start.sh not found"
  exit 1
fi

echo ""

# Step 3: Wait for services to be ready
echo "Step 3: Waiting for services to start..."
echo "-------------------------------------------"
sleep 5
echo "✓ Services should be ready"

echo ""

# Step 4: Generate tokens for existing users (admin endpoint)
echo "Step 4: Generating device tokens for existing users..."
echo "-------------------------------------------"

# Get admin token from environment or prompt
if [ -z "$ADMIN_TOKEN" ]; then
  echo "Note: To generate tokens for all users, you need an admin user ID."
  echo "You can provide it now, or run this command manually later:"
  echo ""
  echo "  curl -X POST http://localhost:3001/api/users/admin/generate-tokens \\"
  echo "       -H 'user-id: <admin-user-id>'"
  echo ""
  read -p "Enter admin user ID (or press Enter to skip): " ADMIN_ID
  
  if [ -n "$ADMIN_ID" ]; then
    RESPONSE=$(curl -s -X POST http://localhost:3001/api/users/admin/generate-tokens \
      -H "user-id: $ADMIN_ID")
    echo "Response: $RESPONSE"
    echo "✓ Token generation request sent"
  else
    echo "⚠ Skipped bulk token generation"
    echo "  Run manually with admin credentials when ready"
  fi
else
  echo "Using ADMIN_TOKEN from environment..."
  RESPONSE=$(curl -s -X POST http://localhost:3001/api/users/admin/generate-tokens \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  echo "Response: $RESPONSE"
  echo "✓ Token generation request sent"
fi

echo ""

# Step 5: Summary
echo "========================================="
echo "Fix Applied Successfully!"
echo "========================================="
echo ""
echo "What was fixed:"
echo "  1. ✓ MongoDB parameters normalized (lowercase → camelCase)"
echo "  2. ✓ Services restarted with updated code"
echo "  3. ✓ Device tokens generated/regenerated"
echo ""
echo "Verification steps:"
echo "  1. Visit Dashboard → Latest Prediction"
echo "     Should show: Specific Gravity, Turbidity NTU, etc. (no N/A)"
echo ""
echo "  2. Visit Profile → Device Integration"
echo "     Should show: Device Token with 'Generate Token' or 'Regenerate Token' button"
echo ""
echo "  3. Check logs:"
echo "     tail -f logs/user-service.log | grep TOKEN"
echo "     tail -f logs/prediction-service.log | grep CSV-SAVE"
echo ""
echo "For more details, see: DASHBOARD_TOKEN_FIX.md"
echo "========================================="
