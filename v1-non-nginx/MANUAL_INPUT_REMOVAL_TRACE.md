# Manual Input Components Trace

## Overview
This document traces all manual input related code in the MLPrediction.js component. All code has been marked with `// HAPUS SAYA` or `{/* HAPUS SAYA */}` comments and is ready for removal upon user confirmation.

---

## MLPrediction.js Code Locations

### State Variables (COMMENTED)
**Lines 8-18**: `singleRecord` state object
```javascript
// HAPUS SAYA - Manual Input State (lines 8-18)
/*
const [singleRecord, setSingleRecord] = useState({
  ph: '',
  tds: '',
  specificGravity: '',
  turbidityNTU: '',
  red: 255,
  green: 220,
  blue: 150,
  turbidityLevel: 'Jernih',
  warnaDasar: 'KUNING'
});
*/
```

**Line 30**: Default activeTab changed from 'manual' to 'csv'
```javascript
const [activeTab, setActiveTab] = useState('csv'); // Changed from 'manual' to 'csv' - HAPUS SAYA related
```

### Functions (COMMENTED)

**Lines ~315**: `handleInputChange` function
```javascript
// HAPUS SAYA - handleInputChange for Manual Input (line ~315)
/*
const handleInputChange = (e) => {
  const { name, value } = e.target;
  setSingleRecord({ ...singleRecord, [name]: value });
};
*/
```

**Lines 320-390**: `validateSingleRecord` function
```javascript
// HAPUS SAYA - validateSingleRecord function (lines 320-390)
/*
const validateSingleRecord = () => {
  // Full validation logic for all 9 parameters
  // pH, TDS, Specific Gravity, Turbidity NTU
  // RGB values (red, green, blue)
  // Turbidity Level, Warna Dasar
  return true/false;
};
*/
```

**Lines 535-586**: `handleValuesSubmit` function
```javascript
// HAPUS SAYA - handleValuesSubmit function (lines 535-586)
/*
const handleValuesSubmit = async (e) => {
  e.preventDefault();
  // Validates input using validateSingleRecord()
  // Converts values to numbers
  // Calls predictionAPI.submitValues({ parameters: data })
  // Sets results state with response
};
*/
```

### UI Components (COMMENTED)

**Lines 697-705**: Manual Input Tab Navigation
```javascript
{/* HAPUS SAYA - Manual Input Tab (lines 697-705) */}
{/*
<Nav.Item>
  <Nav.Link 
    className={activeTab === 'manual' ? 'active' : ''} 
    onClick={() => setActiveTab('manual')}
  >
    <i className="fas fa-keyboard me-2"></i>
    Manual Input
  </Nav.Link>
</Nav.Item>
*/}
```

**Lines 798-991**: Manual Input Form JSX (Complete Form)
```javascript
{/* HAPUS SAYA - Manual Input Form JSX (lines 798-985) */}
{/*
{activeTab === 'manual' ? (
  <Form onSubmit={handleValuesSubmit}>
    // Core Urine Parameters section
    // - pH input (4.5-8.0)
    // - TDS input (0-2000 ppm)
    // - Specific Gravity input (1.005-1.030)
    // - Turbidity NTU input (0-100)
    
    // Categorical Parameters section
    // - Turbidity Level select (Jernih/Agak Keruh/Keruh)
    // - Warna Dasar select (BENING/KUNING/MERAH/COKLAT/ORANGE/HIJAU/BIRU)
    
    // RGB Color Values section
    // - Red slider (0-255)
    // - Green slider (0-255)
    // - Blue slider (0-255)
    // - Color preview box
    
    // Submit button
    <Button type="submit">Generate Prediction</Button>
  </Form>
) : activeTab === 'csv' ? (
*/}
{/* END HAPUS SAYA - Manual Input Form */}
```

---

## API Layer

### api.js (NOT MODIFIED - May be used elsewhere)
**Lines 541-546**: `submitValues` function
```javascript
export const predictionAPI = {
  submitValues: async (data) => {
    return API.post('/api/predict', data);
  },
  // ... other methods
};
```

**Note**: This API method is NOT commented out because:
1. It may be used by other components (check required)
2. Backend endpoint POST `/api/predict` may serve other purposes
3. Need to verify no other components call `predictionAPI.submitValues()`

---

## Backend Endpoints (NOT MODIFIED)

### prediction-service.js
**Endpoint**: POST `/` (single prediction)
- Used by: Manual input form (now disabled)
- Functionality: Accepts single parameter set, calls ML service, returns prediction
- Status: **Keep endpoint** (may be used by API tests or other future features)

---

## Dependencies Check

### Components That DO NOT Use Manual Input
✅ **Dashboard.js** - Uses GET `/api/predict/stats` (different endpoint)
✅ **Profile.js** - No prediction functionality
✅ **History.js** - Displays saved predictions (read-only)
✅ **MLPrediction.js CSV Upload** - Uses POST `/api/predict/csv` (separate flow)
✅ **MLPrediction.js Auto Data** - Fetches from POST `/api/predict/auto-data` (separate flow)

### Conclusion
Manual input is **isolated** to MLPrediction.js only. No other components depend on it.

---

## Removal Strategy

### Phase 1: Comment Code (COMPLETED ✅)
- [x] Comment singleRecord state
- [x] Comment handleInputChange function
- [x] Comment validateSingleRecord function
- [x] Comment handleValuesSubmit function
- [x] Comment manual tab navigation
- [x] Comment entire manual form JSX
- [x] Change default activeTab from 'manual' to 'csv'
- [x] Add note at top of file explaining changes

### Phase 2: User Confirmation (PENDING ⏳)
- [ ] User tests CSV upload (should still work)
- [ ] User tests Auto Data (should still work)
- [ ] User confirms no manual input needed
- [ ] User approves deletion

### Phase 3: Delete Code (PENDING ⏳)
- [ ] Remove all commented code blocks
- [ ] Remove singleRecord state (no longer used)
- [ ] Verify no errors in browser console
- [ ] Run `npm run build` to check for build errors
- [ ] Update documentation

### Phase 4: Clean Up (PENDING ⏳)
- [ ] Check if `predictionAPI.submitValues` is used elsewhere
- [ ] Remove submitValues from api.js if unused
- [ ] Check if POST `/api/predict` backend endpoint is used elsewhere
- [ ] Consider keeping backend endpoint for future API access
- [ ] Remove unused imports (if any)

---

## Testing After Removal

### CSV Upload Test
```bash
# 1. Start services
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./start.sh

# 2. Open browser
http://localhost:7764

# 3. Navigate to ML Prediction
# Should show only CSV Upload and Auto Data tabs (no Manual Input)

# 4. Upload CSV file
# Expected: Successful upload, results displayed

# 5. Check console
# Expected: No errors related to singleRecord or handleValuesSubmit
```

### Build Test
```bash
cd frontend
npm run build
# Expected: Build completes without errors
# No warnings about unused variables (singleRecord, handleInputChange, etc.)
```

### Code Search Test
```bash
# Search for any remaining references to manual input
grep -r "singleRecord" frontend/src/
grep -r "handleValuesSubmit" frontend/src/
grep -r "validateSingleRecord" frontend/src/
# Expected: Only commented code found (marked HAPUS SAYA)
```

---

## Impact Analysis

### What Still Works
✅ CSV Upload - Complete form with file picker, preview, batch processing
✅ Auto Data - IoT device data fetching and prediction
✅ Results Display - Unified results table for all prediction types
✅ Model Info - Kidney stone model status and details

### What Is Disabled
❌ Manual Input Tab - Hidden from navigation
❌ Manual Parameter Form - All inputs commented out
❌ Single Record Validation - Function commented out
❌ Manual Submit Handler - Function commented out

### User Experience Change
- **Before**: 3 tabs (Manual Input, CSV Upload, Auto Data)
- **After**: 2 tabs (CSV Upload, Auto Data)
- **Default View**: CSV Upload tab (was Manual Input)
- **Navigation**: No manual input option available

---

## Rollback Plan (If Needed)

### If User Wants Manual Input Back
1. Open MLPrediction.js
2. Search for `HAPUS SAYA` comments
3. Uncomment all blocks:
   - State: `singleRecord`
   - Functions: `handleInputChange`, `validateSingleRecord`, `handleValuesSubmit`
   - UI: Manual tab navigation, manual form JSX
4. Change `activeTab` default back to `'manual'`
5. Remove note at top of file
6. Run `npm run build`
7. Test manual input form

### Quick Restore Command
```bash
# If code is still commented (not deleted), run:
cd frontend/src/pages
# Use editor to find-replace:
# Find: {/* HAPUS SAYA
# Replace: (remove comment start)
# Find: HAPUS SAYA */}
# Replace: (remove comment end)
# Find: // HAPUS SAYA
# Replace: (remove comment)
```

---

## Related Files Modified

1. **MLPrediction.js** - All manual input code commented
2. **api.js** - NO CHANGES (kept for potential future use)
3. **prediction-service.js** - NO CHANGES (backend endpoint intact)

---

## Next Steps

1. ✅ All code commented with HAPUS SAYA markers
2. ⏳ User tests CSV and Auto Data functionality
3. ⏳ User confirms no errors in console
4. ⏳ User approves deletion
5. ⏳ Remove commented code blocks
6. ⏳ Clean up unused imports
7. ⏳ Update this documentation with final results

---

## Notes

- Manual input was the original prediction method
- CSV upload and Auto Data were added later as more efficient alternatives
- Manual input removal simplifies UI and reduces code complexity
- Backend endpoint preserved for potential API access or future features
- All commented code can be easily restored if needed
