# Frontend - Urine Disease Detection System

This is the React-based frontend for the Urine Disease Detection System, built with React Bootstrap and modern web technologies.

## Features

- **User Authentication**: Secure login and registration system
- **ML Predictions**: Single record and batch CSV predictions for kidney stone detection
- **Dashboard**: Overview of user statistics and recent predictions
- **Prediction History**: View and manage past predictions
- **Profile Management**: Update user profile with image upload
- **Admin Panel**: Administrative features for system management
- **Health Tips**: Educational content about kidney health

## Technology Stack

- React 18
- React Router v6
- React Bootstrap
- Axios for API calls
- FontAwesome icons

## Development

### Prerequisites

- Node.js 16+ 
- npm or yarn

### Installation

```bash
cd deployments/v1-non-nginx/frontend
npm install
```

### Running Locally

```bash
npm start
```

The app will run on `http://localhost:3000` by default.

### Building for Production

```bash
npm run build
```

This creates an optimized production build in the `build/` directory.

## UI/UX Improvements (Production Polish)

The frontend has been thoroughly cleaned to remove debug content and ensure a professional production experience:

### Files Cleaned

- **MLPrediction.js**: Removed 9 console.log statements, simplified repetitive CSV delimiter text to a single concise line
- **TestUpload.js**: Added debug page marker, removed 10 console statements, hidden from user navigation (accessible only via direct URL)
- **Dashboard.js**: Removed 13 console.log/warn/error statements, fixed useEffect dependency warning with ESLint suppression
- **PredictionHistory.js**: Removed 10 console statements, deleted unused `responseDetails` state variable and all related setters
- **Profile.js**: Removed 11 console statements while preserving all image upload, caching, and form functionality
- **Login.js**: Removed unused `config` import, unused `protocolTested` state variable, and 6 console statements
- **App.js**: Removed unused `Home` import and 12 console statements throughout routing logic
- **Navbar.js**: Removed unused `Button`/`Dropdown` imports, unused `authAPI` import, and 1 console.error statement
- **api.js**: Removed 40+ console statements and unused `originalConsoleLog` variable while preserving error suppressor logic
- **colors.js**: Fixed ESLint anonymous default export warning by creating named `colorPalette` constant

### Testing Instructions

1. **Build Verification**: Run `npm run build` to verify zero ESLint warnings
2. **Console Cleanup**: Open browser DevTools console and test user pages (Login → Dashboard → MLPrediction → History → Profile) - should see no debug logs on user-facing pages
3. **TestUpload Page**: Verify `/test-upload` is not linked in user navbar (debug-only page)

### Admin Exception

**AdminDashboard.js** intentionally retains console.logs and debug features for administrative troubleshooting and system monitoring. This is by design to help admins diagnose issues without affecting user experience.

## Project Structure

```
src/
├── components/         # Reusable UI components (Navbar, etc.)
├── pages/             # Page components
│   ├── MLPrediction.js
│   ├── Dashboard.js
│   ├── PredictionHistory.js
│   ├── Profile.js
│   ├── Login.js
│   ├── Register.js
│   ├── HealthTips.js
│   ├── AdminDashboard.js
│   └── TestUpload.js  # Debug page (hidden from users)
├── services/          # API service layer
│   └── api.js
├── App.js             # Main app component with routing
├── colors.js          # Theme and color palette
└── index.js           # Entry point
```

## API Integration

The frontend communicates with the backend microservices through the API gateway at `https://172.29.156.41:7763`. All API calls include authentication tokens and proper error handling.

## License

See root LICENSE file for details.
