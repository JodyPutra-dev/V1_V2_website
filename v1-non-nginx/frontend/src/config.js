/**
 * Application Configuration
 * Handles protocol selection, API URLs, and fallback mechanisms
 * Supports both NGINX proxy and direct backend access
 */

// Dynamically determine protocol and hostname
// V1 DEPLOYMENT: Support both HTTP and HTTPS
// V1 runs HTTPS on port 7763 (direct Node.js SSL), V2 runs HTTPS with NGINX on port 7763
const currentProtocol = window.location.protocol.includes('https') ? 'https' : 'http';
const hostname = window.location.hostname || 'localhost';

// Detect if we're running behind NGINX or directly
const isNginxMode = () => {
  // Check if we're on port 80/443 (typical NGINX ports) or if there's a specific env var
  const port = parseInt(window.location.port) || (currentProtocol === 'https' ? 443 : 80);
  const nginxPorts = [80, 443, 7762, 7763]; // Common NGINX ports
  return nginxPorts.includes(port) || process.env.REACT_APP_USE_NGINX === 'true';
};

// Check if we're in direct production mode (systemd, no separate frontend server)
const isDirectProductionMode = () => {
  // In direct production mode:
  // - Frontend is served from gateway (port 7764)
  // - No separate frontend port (7891)
  // - Built with REACT_APP_DIRECT_PROD=true
  return process.env.REACT_APP_DIRECT_PROD === 'true' || 
         (process.env.NODE_ENV === 'production' && 
          process.env.REACT_APP_DIRECT_API === 'true' &&
          window.location.port === '7764');
};

// Check if we should use React's proxy (development mode)
const shouldUseReactProxy = () => {
  return process.env.NODE_ENV === 'development' && !process.env.REACT_APP_DIRECT_API;
};

const config = {
  // Current protocol based on browser location
  protocol: currentProtocol,
  
  // Host settings
  hostname: hostname,
  
  // Deployment mode detection
  nginxMode: isNginxMode(),
  reactProxyMode: shouldUseReactProxy(),
  directProductionMode: isDirectProductionMode(),
  
  // Port settings
  ports: {
    gateway: {
      http: 7764,
      https: 7763
    },
    frontend: {
      http: 7891,
      https: 7891
    }
  },
  
  // Theme
  colorTheme: 'orange', // 'blue' or 'orange'
  
  // API URLs - Smart routing based on deployment mode
  get apiUrl() {
    // Mode 1: React Proxy Mode (Development with package.json proxy)
    if (this.reactProxyMode) {
      return ''; // Use relative URLs, React proxy will handle it
    }
    
    // Mode 2: Direct Production Mode (Frontend served by Gateway on same port)
    if (this.directProductionMode) {
      // Frontend and API on same origin/port, use relative URLs for API
      return '';
    }
    
    // Mode 3: NGINX Mode (Production with NGINX reverse proxy)
    if (this.nginxMode) {
      // Use same origin as frontend, NGINX will proxy to backend
      return `${this.protocol}://${this.hostname}${window.location.port ? ':' + window.location.port : ''}`;
    }
    
    // Mode 4: Direct Development Mode (No NGINX, direct backend access)
    if (this.protocol === 'https') {
      return `https://${this.hostname}:${this.ports.gateway.https}`;
    }
    return `http://${this.hostname}:${this.ports.gateway.http}`;
  },
  
  // Direct HTTP API URL for fallback
  get directApiUrl() {
    return `http://${this.hostname}:${this.ports.gateway.http}`;
  },
  
  // Frontend URLs
  get frontendUrl() {
    return `${this.protocol}://${this.hostname}:${this.protocol === 'https' ? this.ports.frontend.https : this.ports.frontend.http}`;
  },
  
  // API health endpoint
  get healthEndpoint() {
    // Always use the matching protocol to avoid mixed content
    return `${this.apiUrl}/api/health`;
  },
  
  // Debug flags
  debug: {
    logApiCalls: true,
    verbose: true
  },
  
  // Connection timeouts (in ms)
  timeouts: {
    default: 30000,
    login: 10000
  },
  
  // Function to test connectivity and determine best protocol
  testConnectivity: async () => {
    if (typeof window === 'undefined') return false;
    
    try {
      const response = await fetch(`${config.apiUrl}/api/health`, { 
        method: 'GET',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      
      if (response.ok) {
        console.log('API connection successful using', config.protocol);
        return true;
      }
    } catch (error) {
      console.error('API connection failed:', error.message);
      
      // Try alternate protocol
      const altProtocol = config.protocol === 'https' ? 'http' : 'https';
      const altUrl = `${altProtocol}://${config.hostname}:${config.ports.gateway[altProtocol]}/api/health`;
      
      try {
        console.log('Trying alternate protocol:', altUrl);
        const altResponse = await fetch(altUrl, { 
          method: 'GET',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });
        
        if (altResponse.ok) {
          console.log('Connection successful with alternate protocol');
          // We don't switch automatically as this would modify a read-only property
          return true;
        }
      } catch (altError) {
        console.error('Alternative protocol also failed:', altError.message);
      }
    }
    
    return false;
  }
};

// Log configuration in development
if (process.env.NODE_ENV !== 'production') {
  console.log('App Configuration:', {
    protocol: config.protocol,
    hostname: config.hostname,
    nginxMode: config.nginxMode,
    reactProxyMode: config.reactProxyMode,
    directProductionMode: config.directProductionMode,
    currentMode: config.reactProxyMode ? 'React Proxy' : 
                 config.directProductionMode ? 'Direct Production' :
                 config.nginxMode ? 'NGINX Proxy' : 'Direct Development',
    apiUrl: config.apiUrl,
    directApiUrl: config.directApiUrl,
    frontendUrl: config.frontendUrl,
    healthEndpoint: config.healthEndpoint
  });
}

export default config; 