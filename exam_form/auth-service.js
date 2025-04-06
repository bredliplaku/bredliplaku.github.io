// auth-service.js
// A service to handle authentication for both exam form and admin dashboard

class AuthService {
    constructor(config) {
        this.config = config;
        this.lastActivity = Date.now();
        this.initialized = false;
        this.isSignedIn = false;
        this.currentUser = null;
        this.tokenRefreshInterval = null;
        this.activityTimeout = null;
        
        // Bind event handlers
        this.handleSignIn = this.handleSignIn.bind(this);
        this.handleSignOut = this.handleSignOut.bind(this);
        this.updateSignInStatus = this.updateSignInStatus.bind(this);
        this.resetActivityTimer = this.resetActivityTimer.bind(this);
        this.checkInactivity = this.checkInactivity.bind(this);
    }
    
    /**
     * Initialize the authentication service
     */
    async initialize() {
        if (this.initialized) return;
        
        return new Promise((resolve, reject) => {
            gapi.load('client:auth2', async () => {
                try {
                    await gapi.client.init({
                        apiKey: this.config.API_KEY,
                        clientId: this.config.CLIENT_ID,
                        discoveryDocs: [
                            "https://sheets.googleapis.com/$discovery/rest?version=v4",
                            "https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest"
                        ],
                        scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
                    });
                    
                    // Listen for sign-in state changes
                    gapi.auth2.getAuthInstance().isSignedIn.listen(this.updateSignInStatus);
                    
                    // Handle the initial sign-in state
                    await this.updateSignInStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
                    
                    // Set up activity monitoring
                    this.setupActivityMonitoring();
                    
                    // Check for token in URL hash (for redirect flow)
                    this.handleHashToken();
                    
                    this.initialized = true;
                    resolve(true);
                } catch (error) {
                    console.error('Failed to initialize Auth Service:', error);
                    reject(error);
                }
            });
        });
    }
    
    /**
     * Set up activity monitoring to detect user inactivity
     */
    setupActivityMonitoring() {
        // Listen for user activity
        document.addEventListener('mousemove', this.resetActivityTimer);
        document.addEventListener('keypress', this.resetActivityTimer);
        document.addEventListener('click', this.resetActivityTimer);
        
        // Start activity check timer
        this.activityTimeout = setInterval(this.checkInactivity, 60 * 1000); // Check every minute
        
        // Setup token refresh
        this.setupTokenRefresh();
    }
    
    /**
     * Reset the activity timer
     */
    resetActivityTimer() {
        this.lastActivity = Date.now();
    }
    
    /**
     * Check for user inactivity
     */
    async checkInactivity() {
        const inactiveTime = Date.now() - this.lastActivity;
        
        // If user has been inactive for longer than the session timeout
        if (inactiveTime >= this.config.SESSION_TIMEOUT) {
            // If signed in, trigger session expiration
            if (this.isSignedIn) {
                this.handleSessionExpired();
            }
        }
    }
    
    /**
     * Handle session expiration due to inactivity
     */
    handleSessionExpired() {
        // Trigger session expired event
        const event = new CustomEvent('session-expired', {
            detail: { timestamp: new Date() }
        });
        document.dispatchEvent(event);
        
        // Try to refresh token
        this.refreshToken().catch(() => {
            // If refresh fails, sign out
            this.isSignedIn = false;
        });
    }
    
    /**
     * Setup token refresh interval
     */
    setupTokenRefresh() {
        // Clear any existing interval
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
        }
        
        // Set up refresh interval (50 minutes)
        this.tokenRefreshInterval = setInterval(() => {
            if (this.isSignedIn) {
                this.refreshToken();
            }
        }, 50 * 60 * 1000);
    }
    
    /**
     * Refresh the auth token
     */
    async refreshToken() {
        try {
            await gapi.auth2.getAuthInstance().currentUser.get().reloadAuthResponse();
            return true;
        } catch (error) {
            console.error('Failed to refresh token:', error);
            return false;
        }
    }
    
    /**
     * Handle token in URL hash (for redirect flow)
     */
    handleHashToken() {
        if (window.location.hash && window.location.hash.includes('access_token=')) {
            // Parse the hash parameters
            const params = {};
            window.location.hash.substring(1).split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                params[key] = decodeURIComponent(value);
            });
            
            if (params.access_token) {
                // Set the token in gapi client
                gapi.client.setToken({ access_token: params.access_token });
                localStorage.setItem('gapi_token', JSON.stringify({ access_token: params.access_token }));
                this.isSignedIn = true;
                
                // Clean up the URL to remove the token (for security)
                if (history.replaceState) {
                    history.replaceState(null, null, window.location.pathname);
                } else {
                    window.location.hash = '';
                }
                
                // Fetch user info
                this.getUserInfo().then(user => {
                    // Trigger sign-in event
                    const event = new CustomEvent('user-signed-in', {
                        detail: { user }
                    });
                    document.dispatchEvent(event);
                });
            }
        }
    }
    
    /**
     * Update sign-in status
     */
    async updateSignInStatus(isSignedIn) {
        this.isSignedIn = isSignedIn;
        
        if (isSignedIn) {
            // Get user information
            const user = await this.getUserInfo();
            this.currentUser = user;
            
            // Trigger sign-in event
            const event = new CustomEvent('user-signed-in', {
                detail: { user }
            });
            document.dispatchEvent(event);
        } else {
            this.currentUser = null;
            
            // Trigger sign-out event
            const event = new CustomEvent('user-signed-out');
            document.dispatchEvent(event);
        }
        
        return this.isSignedIn;
    }
    
    /**
     * Get current user information
     */
    async getUserInfo() {
        try {
            const response = await gapi.client.oauth2.userinfo.get();
            return response.result;
        } catch (error) {
            console.error('Failed to get user info:', error);
            return null;
        }
    }
    
    /**
     * Sign in with Google (popup flow)
     */
    async handleSignIn() {
        try {
            await gapi.auth2.getAuthInstance().signIn();
            return true;
        } catch (error) {
            console.error('Sign in error:', error);
            return false;
        }
    }
    
    /**
     * Sign in with Google (redirect flow)
     */
    handleSignInRedirect() {
        // Create Google OAuth URL with scopes
        const scopes = encodeURIComponent(
            "https://www.googleapis.com/auth/spreadsheets " + 
            "https://www.googleapis.com/auth/userinfo.email " + 
            "https://www.googleapis.com/auth/userinfo.profile"
        );
        const redirectUri = encodeURIComponent(window.location.href.split('#')[0]); // Remove any existing hash
        
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
                       `client_id=${this.config.CLIENT_ID}&` +
                       `redirect_uri=${redirectUri}&` +
                       `response_type=token&` +
                       `prompt=select_account&` +
                       `scope=${scopes}`;
        
        // Open Google auth in same window to ensure proper redirect
        window.location.href = authUrl;
    }
    
    /**
     * Sign out
     */
    async handleSignOut() {
        try {
            await gapi.auth2.getAuthInstance().signOut();
            localStorage.removeItem('gapi_token');
            return true;
        } catch (error) {
            console.error('Sign out error:', error);
            return false;
        }
    }
    
    /**
     * Check if the current user is admin
     */
    isAdmin() {
        if (!this.currentUser || !this.currentUser.email) {
            return false;
        }
        
        return this.config.ADMIN_EMAILS.includes(this.currentUser.email);
    }
    
    /**
     * Validate the current token
     */
    async validateToken() {
        if (!this.isSignedIn) return false;
        
        try {
            // Try to make a simple API call to validate the token
            await gapi.client.request({
                'path': 'https://www.googleapis.com/oauth2/v2/userinfo',
                'method': 'GET'
            });
            return true;
        } catch (error) {
            console.error('Token validation failed:', error);
            
            // Try to refresh the token
            const refreshed = await this.refreshToken();
            if (refreshed) {
                return true;
            }
            
            // If refresh fails, sign out
            this.isSignedIn = false;
            return false;
        }
    }
}

// Export the service
window.AuthService = AuthService;