# V1 Non-NGINX Deployment - Parameter Migration Guide
## Old 6-Parameter System → New 9-Parameter System

### Overview

This guide is specific to the **V1 Non-NGINX deployment** (baseline configuration with intentional bottlenecks for thesis research). The V1 deployment uses the same 9-parameter system as the main codebase but preserves performance bottlenecks for comparison purposes.

**Migration Status**: ✅ Schemas Updated | ✅ Indexes Added | ✅ Validation Updated (validateUrineData with NEW ranges)

---

## V1-Specific Configuration

### Deployment Characteristics

The V1 deployment maintains the following characteristics while using the new 9-parameter system:

- **Small MongoDB pool**: 5 connections (vs 50 in V2)
- **Synchronous validation loops**: Request-by-request parameter validation in ml-service
- **Sync logging**: Blocks on log writes in gateway
- **No request queuing**: Processes predictions sequentially
- **No PM2 clustering**: Single Node.js process per service

**Important**: These bottlenecks are **intentional** for thesis research comparing V1 (baseline) vs V2 (optimized) performance. The 9-parameter system is identical in both deployments.

---

## Parameter Mapping Table

| Old Parameter | New Parameter(s) | Type | Notes |
|--------------|------------------|------|-------|
| `gravity` | `specificGravity` | Number (1.005-1.030) | Renamed for clarity |
| `ph` | `ph` | Number (4.5-8.0) | **Unchanged** |
| `osmo` | `tds` | Number (0-2000 ppm) | Osmolality replaced with Total Dissolved Solids |
| `cond` | `turbidityNTU` | Number (0-100 NTU) | Conductivity replaced with Turbidity measurement |
| `urea` | `red`, `green`, `blue` | Numbers (0-255 each) | Replaced with RGB color values |
| `calc` | `turbidityLevel`, `warnaDasar` | Enums | Replaced with categorical turbidity and color classification |
| *(new)* | `analisis` | String (optional) | Additional analysis notes |

---

## MongoDB Schema Changes

### Prediction Schema (V1)

**Location**: `deployments/v1-non-nginx/microservices/prediction/prediction-service.js` (lines 224-236)

```javascript
parameters: {
  ph: Number,
  tds: Number,
  specificGravity: Number,
  turbidityNTU: Number,
  red: Number,
  green: Number,
  blue: Number,
  turbidityLevel: { type: String, enum: ['Jernih', 'Agak Keruh', 'Keruh'] },
  warnaDasar: { type: String, enum: ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU'] },
  analisis: String,
  additional: mongoose.Schema.Types.Mixed
}
```

### AutoData Schema (V1)

**Location**: `deployments/v1-non-nginx/microservices/ml/ml-service.js` (lines 67-128)

The V1 AutoData schema uses **nested structure** for IoT device uploads:

```javascript
{
  ph: { value: Number, timestamp: Date },
  tds: { value: Number, timestamp: Date },
  specificGravity: { value: Number, timestamp: Date },
  turbidityNTU: { value: Number, timestamp: Date },
  red: { value: Number, timestamp: Date },
  green: { value: Number, timestamp: Date },
  blue: { value: Number, timestamp: Date },
  turbidityLevel: String,
  warnaDasar: String,
  userId: ObjectId,
  timestamp: Date
}
```

### Indexes (V1)

**Prediction indexes** (gateway, prediction-service, admin-service):
- `{ user: 1, date: -1 }`
- `{ date: -1 }`
- `{ penyakit: 1, date: -1 }`
- `{ 'parameters.turbidityLevel': 1 }` *(new)*
- `{ 'parameters.warnaDasar': 1 }` *(new)*

**AutoData indexes** (ml-service):
- `{ userId: 1, timestamp: -1 }`
- `{ turbidityLevel: 1 }` *(new)*
- `{ warnaDasar: 1 }` *(new)*
- `{ userId: 1, turbidityLevel: 1 }` *(new)*
- `{ userId: 1, warnaDasar: 1 }` *(new)*

---

## Validation (V1-Specific)

### validateUrineData() Function

**Location**: `deployments/v1-non-nginx/microservices/ml/ml-service.js` (lines 716-778)

The V1 deployment has a **comprehensive validation function** that enforces all new parameter ranges:

```javascript
function validateUrineData(data) {
  const errors = [];
  
  // pH validation (4.5-8.0)
  if (data.ph === undefined || data.ph < 4.5 || data.ph > 8.0) {
    errors.push('pH must be between 4.5 and 8.0');
  }
  
  // TDS validation (0-2000 ppm)
  if (data.tds === undefined || data.tds < 0 || data.tds > 2000) {
    errors.push('TDS must be between 0 and 2000 ppm');
  }
  
  // Specific Gravity validation (1.005-1.030)
  if (data.specificGravity === undefined || data.specificGravity < 1.005 || data.specificGravity > 1.030) {
    errors.push('Specific Gravity must be between 1.005 and 1.030');
  }
  
  // Turbidity NTU validation (0-100)
  if (data.turbidityNTU === undefined || data.turbidityNTU < 0 || data.turbidityNTU > 100) {
    errors.push('Turbidity NTU must be between 0 and 100');
  }
  
  // RGB validations (0-255 each)
  ['red', 'green', 'blue'].forEach(color => {
    if (data[color] === undefined || data[color] < 0 || data[color] > 255) {
      errors.push(`${color} must be between 0 and 255`);
    }
  });
  
  // Enum validations
  const validTurbidityLevels = ['Jernih', 'Agak Keruh', 'Keruh'];
  if (!validTurbidityLevels.includes(data.turbidityLevel)) {
    errors.push(`turbidityLevel must be one of: ${validTurbidityLevels.join(', ')}`);
  }
  
  const validWarnaOptions = ['BENING', 'KUNING', 'MERAH', 'COKLAT', 'ORANGE', 'HIJAU', 'BIRU'];
  if (!validWarnaOptions.includes(data.warnaDasar)) {
    errors.push(`warnaDasar must be one of: ${validWarnaOptions.join(', ')}`);
  }
  
  return errors;
}
```

**Performance Note**: This validation runs in a **synchronous loop** for each prediction request, adding ~10-20ms delay per request (intentional bottleneck for thesis comparison).

---

## Migration Script Usage

### Shared MongoDB

**Important**: V1 and V2 deployments share the same MongoDB database. Running the migration script affects **both** deployments.

### Migration Command

Run from main project directory:

```bash
cd /var/www/html/HIBAH
node migrate_predictions.js
```

Or run parameters-only migration:

```bash
node migrate_predictions.js --params-only
```

### Expected Performance

Due to V1's small MongoDB pool (5 connections), migration may be **slower** than in V2:

- **Small pool**: ~100-150 predictions/minute (vs 300-400/min in V2)
- **No async optimizations**: Sequential updates
- **Sync logging**: Additional overhead from log writes

**Recommendation**: Run migration during low-traffic periods.

---

## Testing Checklist (V1-Specific)

### Manual Prediction Test
- [ ] Start V1 services: `cd /var/www/html/HIBAH/deployments/v1-non-nginx && ./start.sh`
- [ ] Access V1 gateway: `http://localhost:3001` (or configured port)
- [ ] Submit prediction with all 9 new parameters
- [ ] Verify validation errors for out-of-range values (pH 10.0 → 400 error)
- [ ] Check logs: `tail -f ../../logs/ml-service.log` (sync logging shows all validations)
- [ ] Confirm ~500ms+ prediction time (bottleneck preserved)

### CSV Upload Test
- [ ] Upload CSV with new 9-column headers to V1
- [ ] Verify synchronous processing (no parallel batching)
- [ ] Check each row validated individually (validation loop)
- [ ] Confirm errors logged synchronously

### Auto-Data Test (IoT)
- [ ] Send IoT device upload with new 9 parameters
- [ ] Verify device token validation (from IoT system)
- [ ] Confirm AutoData nested structure saved (ph.value, tds.value, etc.)
- [ ] Query `/autodata` via V1 gateway
- [ ] Check userId linking preserved

### Performance Comparison Test
- [ ] Run same test in V1 and V2 deployments
- [ ] Compare prediction times (V1 ~600ms, V2 ~200ms expected)
- [ ] Verify parameter structure identical in both
- [ ] Confirm bottleneck differences logged (sync vs async)

---

## Troubleshooting (V1-Specific)

### Issue: V1 prediction slower than expected
**Expected behavior**: V1 is intentionally slower (~500-600ms vs V2's ~200ms) due to:
- Sync validation loops (validateUrineData called for each param)
- Small MongoDB pool (5 connections, potential queuing)
- Sync logging (blocks on write)
- No request queuing (sequential processing)

**Not a bug**: This is the baseline configuration for thesis research.

### Issue: Validation errors not showing in response
**Cause**: V1 validation returns 400 with error array in body  
**Solution**: Check response.body for `{ success: false, errors: [...] }`

### Issue: Migration timeout in V1
**Cause**: Small MongoDB pool (5 connections) may timeout on large datasets  
**Solution**: 
1. Increase pool temporarily: Edit `ml-service.js` line ~19 `maxPoolSize: 10`
2. Run migration
3. Revert to 5 after completion
4. Or run migration via main codebase (larger pool)

### Issue: CSV export shows old parameters
**Solution**: Verify admin-service.js line ~1167 has NEW predictionFields array, restart admin service

---

## V1 vs V2 Comparison

| Aspect | V1 (Baseline) | V2 (Optimized) |
|--------|---------------|----------------|
| **Parameter System** | ✅ NEW 9-param | ✅ NEW 9-param (identical) |
| **Validation** | Sync loop (slow) | Async batch (fast) |
| **MongoDB Pool** | 5 connections | 50 connections |
| **Logging** | Synchronous | Async (Winston) |
| **Request Handling** | Sequential | Queued (max 6 concurrent) |
| **Prediction Time** | ~600ms | ~200ms |
| **Migration Speed** | ~100 predictions/min | ~300 predictions/min |

**Key Point**: Parameter structure is **identical**. Performance differences come from Node.js/MongoDB optimizations, not ML model changes.

---

## Additional Resources

- **Main Migration Guide**: `/var/www/html/HIBAH/PARAMETER_MIGRATION_GUIDE.md`
- **V2 Migration Guide**: `../v2-nginx-pm2/PARAMETER_MIGRATION_GUIDE.md`
- **V1 Validation Function**: `microservices/ml/ml-service.js` (lines 716-778)
- **V1 Schemas**: `microservices/prediction/prediction-service.js` (lines 224-236)
- **Deployment Comparison**: `../README.md`

---

## Support

For V1-specific issues:
1. Check V1 logs: `tail -f ../../logs/ml-service.log` (relative to v1-non-nginx folder)
2. Verify services running: `ps aux | grep 'node.*v1'`
3. Check MongoDB pool usage: Look for "pool exhausted" warnings
4. Compare with V2 behavior to isolate bottleneck vs bug

**Last Updated**: November 24, 2025  
**V1 Status**: ✅ Schemas Updated | ✅ Indexes Added | ✅ Validation Implemented | ⏳ Frontend Update Pending
