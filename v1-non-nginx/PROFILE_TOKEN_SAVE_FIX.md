# Profile Token Save Fix

## Issue
Users reported device token not saving when clicking "Save Changes" button in Profile page.

## Root Cause (Code Trace)
1. **Profile.js State** (line 18-21): `profileInfo` only contains `{name, email}` - NO `deviceToken`
2. **Form Submit** (line 165-222): `handleProfileInfoSubmit()` sends `profileInfo` to backend
3. **Backend Expects** (`user-service.js` line 1121): `const { name, email, deviceToken } = req.body;`
4. **Token Field** (line 412-418): Disabled input, not editable, not in form state
5. **Result**: Backend receives `{name, email}` only → token unchanged in MongoDB

## Why Token Regeneration Works
- Separate endpoint: `/api/users/regenerate-token` (user-service.js line 1198-1234)
- Separate handler: `handleRegenerateToken()` (Profile.js line 225-255)
- Modal confirmation (line 507-549)
- Updates user state + localStorage correctly (line 234-243)

## Solution
**UI Clarity Fix** (no backend changes):
- Updated Form.Label to "IoT Device Token (Managed Separately)"
- Updated Form.Text helper to clarify token is managed separately
- Added "Managed Separately" label to token section
- Emphasized modal button as the ONLY way to change token
- Removed user expectation that "Save Changes" affects token

## Testing
```bash
# 1. Generate token via modal
Click "Generate Token" → Modal appears → Confirm → Token appears in field

# 2. Verify MongoDB save
mongosh
use urine-disease-detection
db.users.findOne({email: "your@email.com"}, {deviceToken: 1})
# Should show: { deviceToken: "32-char-hex" }

# 3. Verify localStorage
Browser Console: localStorage.getItem('user')
# Should include: "deviceToken":"..."
```

## Files Modified
- `Profile.js`: UI text updates only (lines 409, 436-438)
  - Form.Label: "Device Token (for IoT Devices)" → "IoT Device Token (Managed Separately)"
  - Form.Text: "Use this token..." → "Device token is managed separately..."
- No backend changes (regeneration already works)

## Related Docs
- `DASHBOARD_TOKEN_FIX.md`: Migration for existing users
- `test-device-token.js`: E2E token testing script

## User Instructions
1. **To generate/regenerate token**: Use the "Generate Token" / "Regenerate Token" button below the token field
2. **To update profile name/image**: Use the "Save Changes" button at the bottom of the form
3. **Token is NOT part of profile form**: The two operations are completely separate for security reasons
