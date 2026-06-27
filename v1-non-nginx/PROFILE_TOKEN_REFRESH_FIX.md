# Profile Token Refresh Fix

## Issue
After regenerating device token, success message appears but the input field still shows "Not generated" or old token value.

## Root Cause Analysis

**Evidence from Logs** (`logs/user.log` line 131):
```
POST /api/users/regenerate-token → 200 OK
Response: { deviceToken: "a1b2c3d4e5f6..." }
```

**Backend**: Token generation works correctly
- `user-service.js` line 1210: Creates new token with `crypto.randomBytes(16).toString('hex')`
- MongoDB saves the new token successfully
- API returns 200 OK with new token in response

**Frontend Issue**: State doesn't refresh to show new token
- `Profile.js` line 234-243: Updates `user` state and localStorage correctly
- BUT: Initial `user` state from `useEffect` (line 105) doesn't refetch after regeneration
- Modal closes, success message shows, but input field displays stale data

**Why It Happens**:
1. Component mounts → `useEffect` fetches user via `authAPI.getProfile()` → sets initial state
2. User clicks "Regenerate Token" → modal opens
3. User confirms → `handleRegenerateToken()` calls `/api/users/regenerate-token`
4. Backend generates new token, saves to MongoDB, returns 200 OK
5. Frontend updates state with `setUser(prev => ({ ...prev, deviceToken: newToken }))`
6. **Problem**: The `prev` state still has old data because we never refetched from `/api/auth/me`
7. Modal closes, success message shows, but input bound to `user?.deviceToken` displays old value

## Solution Applied

**File**: `deployments/v1-non-nginx/frontend/src/pages/Profile.js`  
**Line**: 244 (after success message)  
**Change**: Added refetch of user profile

```javascript
// BEFORE:
setSuccess('Device token regenerated successfully! Update your IoT device.');

// AFTER:
setSuccess('Device token regenerated successfully! Update your IoT device.');

// Refetch user profile to update UI with new token
const updatedProfile = await authAPI.getProfile();
const userData = updatedProfile.data?.data || updatedProfile.data;
if (userData) {
  setUser(userData);
}
```

**Why This Works**:
- Forces fresh GET request to `/api/auth/me` (which includes `deviceToken` per user-service.js line 1454)
- Updates entire `user` state with latest data from MongoDB
- Input field re-renders with new token value from server

## Testing

### Before Fix
```
1. Login → Profile page
2. Token field shows: "Not generated" (or old token)
3. Click "Regenerate Token" button
4. Modal appears → Click "Confirm Regenerate"
5. Success message: "Device token regenerated successfully!"
6. ❌ Token field STILL shows: "Not generated" (unchanged)
7. Refresh page → ✅ NOW shows new token
```

### After Fix
```
1. Login → Profile page
2. Token field shows: "Not generated" (or old token)
3. Click "Regenerate Token" button
4. Modal appears → Click "Confirm Regenerate"
5. Success message: "Device token regenerated successfully!"
6. ✅ Token field IMMEDIATELY shows: "a1b2c3d4e5f6789..." (new 32-char hex)
7. No page refresh needed
```

### Manual Test
```bash
# 1. Restart services
cd /var/www/html/HIBAH/deployments/v1-non-nginx
./stop.sh && ./start.sh

# 2. Open browser with DevTools
# http://localhost:7764
# F12 → Network tab

# 3. Login and navigate to Profile

# 4. Check current token in MongoDB
mongosh
use urine-disease-detection
db.users.findOne({email: "test@example.com"}, {deviceToken: 1})
# Note the current token

# 5. Click "Regenerate Token" → Confirm

# 6. Watch Network tab:
# - POST /api/users/regenerate-token → 200 OK (new token in response)
# - GET /api/auth/me → 200 OK (refetch with new token)

# 7. Verify UI:
# - Input field shows new 32-char hex token
# - Copy button is enabled
# - Success message appears

# 8. Verify MongoDB:
db.users.findOne({email: "test@example.com"}, {deviceToken: 1})
# Token should match what's displayed in UI
```

### Browser Console Test
```javascript
// Before regeneration:
localStorage.getItem('user')
// { "email": "test@example.com", "deviceToken": "old-token-123..." }

// After regeneration (check Network tab):
// 1. POST /api/users/regenerate-token
//    Response: { deviceToken: "new-token-abc..." }
// 2. GET /api/auth/me (NEW - this is the refetch)
//    Response: { deviceToken: "new-token-abc..." }

// After successful update:
localStorage.getItem('user')
// { "email": "test@example.com", "deviceToken": "new-token-abc..." }
```

## Impact

**Before**: User experience broken
- Token regenerates in backend (MongoDB updated)
- Success message misleading (says "regenerated" but UI unchanged)
- User must manually refresh page to see new token
- Confusing UX: "Did it work? Do I need to click again?"

**After**: Seamless user experience
- Token regenerates → UI updates immediately
- No manual page refresh needed
- Clear visual feedback: new token appears in input
- Copy button ready to use with new token

## Data Flow (After Fix)

```
User clicks "Regenerate Token"
    ↓
Modal opens with confirmation
    ↓
User clicks "Confirm Regenerate"
    ↓
POST /api/users/regenerate-token
    ↓ (backend)
crypto.randomBytes(16).toString('hex') → "a1b2c3d4..."
    ↓
user.deviceToken = newToken
    ↓
user.save() → MongoDB updated
    ↓
return { deviceToken: "a1b2c3d4..." }
    ↓ (frontend)
setUser({ ...prev, deviceToken: "a1b2c3d4..." })
    ↓
localStorage.setItem('user', { deviceToken: "a1b2c3d4..." })
    ↓
setSuccess("Device token regenerated...")
    ↓
GET /api/auth/me (refetch) ← NEW STEP
    ↓ (backend)
return { deviceToken: "a1b2c3d4...", name, email, ... }
    ↓ (frontend)
setUser(fullUserData) ← Complete refresh
    ↓
Input re-renders with new token ✅
```

## Related Files
- `frontend/src/pages/Profile.js`: Token regeneration handler (line 225-255)
- `frontend/src/services/api.js`: `regenerateDeviceToken()` and `getProfile()` methods
- `microservices/user/user-service.js`: 
  - POST `/api/users/regenerate-token` (line 1210-1234)
  - GET `/api/auth/me` (line 1424-1459)

## Verification Checklist
- [ ] Services restarted
- [ ] Profile page loads with existing token (if any)
- [ ] "Regenerate Token" button visible
- [ ] Modal appears on button click
- [ ] Confirm button in modal works
- [ ] Network tab shows TWO requests:
  - [ ] POST /api/users/regenerate-token → 200 OK
  - [ ] GET /api/auth/me → 200 OK (refetch)
- [ ] Input field updates immediately (no page refresh)
- [ ] Copy button enabled with new token
- [ ] MongoDB has updated token
- [ ] localStorage has updated token

## Notes
- This fix adds one extra API call (GET /api/auth/me) after regeneration
- Trade-off: Slight performance cost vs. much better UX
- The refetch ensures UI is always in sync with MongoDB (source of truth)
- Alternative considered: Just update local state—but risky if backend fails to save
- Current approach guarantees UI reflects actual database state
