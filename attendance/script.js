// Config
	const ADMIN_EMAILS = ['bplaku@epoka.edu.al', 'bredliplaku@gmail.com']; // Add any admin emails here
	const CLIENT_ID = '740588046540-npg0crodtcuinveu6bua9rd6c3hb2s1m.apps.googleusercontent.com'; 
	const API_KEY = 'AIzaSyD295FTtMHvXxZablRf0f-FR-IQ2dQRPQE';
	const LOGS_SPREADSHEET_ID = '1AvVrBRt4_3GJTVMmFph6UsUsplV9h8jXU93n1ezbMME';
	const DATABASE_SPREADSHEET_ID = '1jgVSIOQFJv4qiILiT1j33Lr6igp0IhEkIWDg_yQUn8c';
	const LOGS_STORAGE_KEY = 'attendance_logs';
	
	// Discovery docs and scopes for Google API
	const DISCOVERY_DOCS = ["https://sheets.googleapis.com/$discovery/rest?version=v4"];
	const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
	
	// App state
	let logs = [];
	let isScanning = false;
	let nfcSupported = false;
	let nfcReader = null;
	let filter = '';
	let dbFilter = '';
	let uidToNameMap = {}; // Map UIDs to names
	let currentSort = 'date-desc'; // Default sort
	let soundEnabled = true; // Sound effects enabled by default
	let isAdmin = false; // Current user is admin
	let isSignedIn = false; // User is signed in
	let currentUser = null; // Current user info
	let tokenClient = null; // Google OAuth token client
	let currentCourse = ''; // Currently selected course
	let availableCourses = []; // Will be populated from spreadsheet
	let isOnline = navigator.onLine;
	let isSyncing = false;
	let isInitializing = true;
	let pendingNotifications = [];
	let criticalErrorsOnly = true;
	let initialSignIn = true; // Flag to track initial sign-in
	let lastScannedUID = null;
	
	// DOM Elements
	const tabs = document.querySelectorAll('.tab');
	const tabContents = document.querySelectorAll('.tab-content');
	const startScanBtn = document.getElementById('start-scan-btn');
	const stopScanBtn = document.getElementById('stop-scan-btn');
	const importExcelBtn = document.getElementById('import-excel-btn');
	const excelInput = document.getElementById('excel-input');
	const filterInput = document.getElementById('filter-input');
	const sortSelect = document.getElementById('sort-select');
	const dbFilterInput = document.getElementById('db-filter-input');
	const importBtn = document.getElementById('import-btn');
	const importInput = document.getElementById('import-input');
	const exportBtn = document.getElementById('export-btn');
	const clearBtn = document.getElementById('clear-btn');
	const addLogBtn = document.getElementById('add-log-btn');
	const addEntryBtn = document.getElementById('add-entry-btn');
	const exportExcelBtn = document.getElementById('export-excel-btn');
	const clearDbBtn = document.getElementById('clear-db-btn');
	const logsTbody = document.getElementById('logs-tbody');
	const databaseTbody = document.getElementById('database-tbody');
	const emptyLogs = document.getElementById('empty-logs');
	const emptyDatabase = document.getElementById('empty-database');
	const filteredCount = document.getElementById('filtered-count');
	const dbEntryCount = document.getElementById('db-entry-count');
	const totalScans = document.getElementById('total-scans');
	const lastScan = document.getElementById('last-scan');
	const databaseStatus = document.getElementById('database-status');
	const notificationArea = document.getElementById('in-page-notification-area');
	const successSound = document.getElementById('success-sound');
	const errorSound = document.getElementById('error-sound');
	const courseSelect = document.getElementById('course-select');
	const syncBtn = document.getElementById('sync-btn');
	const syncStatus = document.getElementById('sync-status');
	const syncText = document.getElementById('sync-text');
	const loginBtn = document.getElementById('login-btn');
	const logoutBtn = document.getElementById('logout-btn');
	const loginContainer = document.getElementById('login-container');
	const userContainer = document.getElementById('user-container');
	const userName = document.getElementById('user-name');
	const userAvatar = document.getElementById('user-avatar');
	const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
	const ADMIN_SCOPE = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
	const TOKEN_SCOPE_KEY = 'token_scope_granted';
	const AUTO_SIGNIN_KEY = 'prevent_auto_signin';
	
	let currentScopes = READONLY_SCOPE; // Initial scope (will be updated based on user role)
	
// Setup all event listeners in one place
function setupEventListeners() {
    // Set up tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Prevent non-admin users from accessing the database tab
            if (tab.getAttribute('data-tab') === 'database-tab' && !isAdmin) {
                return;
            }
            // Remove active class from all tabs and tab contents
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const tabId = tab.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Button event listeners
    const startScanBtn = document.getElementById('start-scan-btn');
    const stopScanBtn = document.getElementById('stop-scan-btn');
    const importExcelBtn = document.getElementById('import-excel-btn');
    const excelInput = document.getElementById('excel-input');
    const filterInput = document.getElementById('filter-input');
    const sortSelect = document.getElementById('sort-select');
    const dbFilterInput = document.getElementById('db-filter-input');
    const importBtn = document.getElementById('import-btn');
    const importInput = document.getElementById('import-input');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');
    const addLogBtn = document.getElementById('add-log-btn');
    const addEntryBtn = document.getElementById('add-entry-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    const clearDbBtn = document.getElementById('clear-db-btn');
    const syncBtn = document.getElementById('sync-btn');
    const courseSelect = document.getElementById('course-select');
    const toggleSoundBtn = document.getElementById('toggle-sound-btn');
	const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (startScanBtn) startScanBtn.addEventListener('click', startScanning);
    if (stopScanBtn) stopScanBtn.addEventListener('click', stopScanning);
    if (importExcelBtn) importExcelBtn.addEventListener('click', () => excelInput.click());
    if (excelInput) excelInput.addEventListener('change', handleExcelFile);
    if (filterInput) filterInput.addEventListener('input', handleFilterChange);
    if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
    if (dbFilterInput) dbFilterInput.addEventListener('input', handleDbFilterChange);
    if (importBtn) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', handleImportFile);
    if (exportBtn) exportBtn.addEventListener('click', exportLogs);
    if (clearBtn) clearBtn.addEventListener('click', clearLogs);
    if (addLogBtn) addLogBtn.addEventListener('click', showAddLogEntryDialog);
    if (addEntryBtn) addEntryBtn.addEventListener('click', showAddEntryDialog);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportDatabaseToExcel);
    if (clearDbBtn) clearDbBtn.addEventListener('click', clearDatabase);
    if (syncBtn) syncBtn.addEventListener('click', syncData);
    if (courseSelect) courseSelect.addEventListener('change', handleCourseChange);
	if (loginBtn) {
        // Use direct event listener without arrow function to ensure proper 'this' binding
        loginBtn.addEventListener('click', handleAuthClick);
        console.log('Login button event listener attached');
    } else {
        console.error('Login button not found!');
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleSignoutClick);
    }
    
    // Table header sort listeners
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.getAttribute('data-sort');
            currentSort = (currentSort === `${sortKey}-asc`) ? `${sortKey}-desc` : `${sortKey}-asc`;
            // Update sort dropdown to match
            sortSelect.value = currentSort;
            updateSortIcons();
            updateLogsList();
        });
    });
    
    // Toggle sound button event
    if (toggleSoundBtn) {
        toggleSoundBtn.addEventListener('click', function() {
            soundEnabled = !soundEnabled;
            toggleSoundBtn.innerHTML = soundEnabled ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
        });
    }
}

// Function to show the main content when ready
function showMainContent() {
    const loadingIndicator = document.getElementById('app-loading');
    const mainContainer = document.getElementById('main-container');
    
    if (loadingIndicator) {
        loadingIndicator.style.opacity = '0';
        loadingIndicator.style.transition = 'opacity 0.5s';
        setTimeout(() => {
            loadingIndicator.style.display = 'none';
        }, 500);
    }
    
    if (mainContainer) {
        mainContainer.classList.remove('content-hidden');
    }
}

// Check for auth redirect
function checkAuthRedirect() {
    // Handle auth redirect token at the very start
    if (window.location.hash && window.location.hash.includes('access_token=')) {
        console.log('Detected auth redirect with token');
        
        // Parse the hash parameters
        const params = {};
        window.location.hash.substring(1).split('&').forEach(pair => {
            const [key, value] = pair.split('=');
            params[key] = decodeURIComponent(value);
        });
        
        if (params.access_token) {
            console.log('Successfully extracted access token');
            
            // Set the token in gapi client (will happen after gapi is loaded)
            const processToken = () => {
                if (typeof gapi !== 'undefined' && gapi.client) {
                    gapi.client.setToken({ access_token: params.access_token });
                    localStorage.setItem('gapi_token', JSON.stringify({ access_token: params.access_token }));
                    isSignedIn = true;
                    
                    // Get user info and update UI
                    fetchUserInfo()
                        .then(() => {
                            isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
                            updateAuthUI();
                            if (isOnline) {
                                fetchAvailableCourses().catch(err => console.error('Error:', err));
                                fetchDatabaseFromSheet().catch(err => console.error('Error:', err));
                            }
                            showMainContent();
                        })
                        .catch(e => {
                            console.error('Error fetching user info after redirect:', e);
                            showMainContent();
                        });
                } else {
                    // If gapi isn't loaded yet, try again shortly
                    setTimeout(processToken, 100);
                }
            };
            
            // Start the token processing
            processToken();
            
            // Clean up the URL to remove the token (for security)
            if (history.replaceState) {
                history.replaceState(null, null, window.location.pathname);
            } else {
                window.location.hash = '';
            }
        }
    }
}
	
	/**
	 * Initialize the application.
	 * Sets up event listeners, checks NFC support, and prepares the UI.
	 */
function init() {
    isInitializing = true;
    
	//Start with nfcSupported as false
    nfcSupported = false;
	
    // Update current year in footer
    updateYear();
    
    // Set up online/offline listeners
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    
    // Check if NFC is supported - ONLY in Chrome on Android
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isChrome = /Chrome/i.test(navigator.userAgent);
    
    if (isAndroid && isChrome && 'NDEFReader' in window) {
        console.log('NFC support detected (Android + Chrome + NDEFReader)');
        nfcSupported = true;
    } else {
        console.log('NFC not supported on this device/browser');
        nfcSupported = false;
        
        // Only show notification on mobile devices where NFC might be expected
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
            pendingNotifications.push({
                type: 'warning',
                title: 'NFC Unsupported',
                message: 'NFC scanning is only supported in Chrome on Android.'
            });
        }
    }
    
    updateScanButtons();
	
	// Set up event listeners
    setupEventListeners();
    
    // Handle auth redirect
    checkAuthRedirect();
    
    // Initialize Google API with shorter timeout
    setTimeout(() => {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
            initGoogleApi();
        } else {
            console.warn('Google API objects not available yet, waiting longer...');
            
            // Try again with a shorter timeout
            setTimeout(() => {
                if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
                    console.log('Google API objects loaded after extended wait');
                    initGoogleApi();
                } else {
                    console.error('Google API objects still not available after extended wait');
                    showImprovedNotification('error', 'API Error', 'Google API libraries not loaded. Please check your internet connection or try using a different browser.');
                    availableCourses = [];
                    populateCourseDropdown();
                    updateAuthUI();
                    showMainContent();
                }
            }, 1000);
        }
    }, 1000);
    
    // Show content after a reasonable timeout even if auth fails
    setTimeout(() => {
        showMainContent();
        isInitializing = false;
        criticalErrorsOnly = false;
        processPendingNotifications();
    }, 3000);
}

function processPendingNotifications() {
if (pendingNotifications.length > 0) {
	// Only show the most recent notification of each type
	const uniqueNotifications = {};
	for (const notification of pendingNotifications) {
		uniqueNotifications[notification.type + notification.title] = notification;
	}
	
	// Display only the unique notifications
	Object.values(uniqueNotifications).forEach(notification => {
		showImprovedNotification(
			notification.type, 
			notification.title, 
			notification.message, 
			notification.duration
		);
	});
	
	pendingNotifications = [];
}
}
	
	/**
	 * Initialize Google API client.
	 * Set up auth token client and event listeners for login/logout.
	 */
function initGoogleApi() {
console.log('Initializing Google API...');

// Handle auth redirect token at the very start
if (window.location.hash.includes('access_token=')) {
	const hash = window.location.hash.substring(1);
	const params = new URLSearchParams(hash);
	const token = params.get('access_token');
	
	if (token) {
		console.log('Found token in URL, processing...');
		localStorage.setItem('gapi_token', JSON.stringify({access_token: token}));
		isSignedIn = true;
		
		// Clean URL
		history.replaceState(null, null, window.location.pathname);
	}
}

// Set default courses
availableCourses = [];
populateCourseDropdown();

// Check if APIs are loaded
if (typeof gapi === 'undefined') {
	console.error('gapi object is undefined');
	showImprovedNotification('error', 'API Error', 'Google API client not loaded.');
	updateAuthUI();
	return;
}

if (typeof google === 'undefined' || typeof google.accounts === 'undefined') {
	console.error('google.accounts object is undefined');
	showImprovedNotification('error', 'API Error', 'Google Identity Services not loaded.');
	updateAuthUI();
	return;
}

// Initialize with basic scopes first
try {
	console.log('Setting up token client first...');
	tokenClient = google.accounts.oauth2.initTokenClient({
		client_id: CLIENT_ID,
		scope: currentScopes,
		callback: function(resp) {
			console.log('Token response received:', resp);
			// Only process if we have an access token
			if (resp && resp.access_token) {
				handleTokenResponse(resp);
			} else if (resp.error) {
				console.error('Token error:', resp.error);
				showImprovedNotification('error', 'Auth Error', 'Failed to obtain access token.');
			}
		}
	});
	console.log('Token client initialized successfully');
} catch (error) {
	console.error('Failed to initialize token client:', error);
	showImprovedNotification('error', 'Auth Error', 'Failed to initialize authentication.');
}

// Load the GAPI client
gapi.load('client', () => {
	gapi.client.init({
		apiKey: API_KEY,
		discoveryDocs: DISCOVERY_DOCS
	}).then(() => {
		console.log('GAPI client initialized successfully');
		
		// Try to restore saved session
		const savedToken = localStorage.getItem('gapi_token');
		if (savedToken) {
			try {
				const tokenObj = JSON.parse(savedToken);
				gapi.client.setToken(tokenObj);
				isSignedIn = true;
				
				fetchUserInfo()
					.then(() => {
						isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
						updateAuthUI();
						if (isOnline) {
							fetchAvailableCourses().catch(err => console.error('Error:', err));
							fetchDatabaseFromSheet().catch(err => console.error('Error:', err));
						}
					})
					.catch(e => {
						console.error('Error fetching user info:', e);
						isSignedIn = false;
						isAdmin = false;
						localStorage.removeItem('gapi_token');
						gapi.client.setToken('');
						updateAuthUI();
					});
			} catch (e) {
				console.error('Error restoring token:', e);
				isSignedIn = false;
				localStorage.removeItem('gapi_token');
				updateAuthUI();
			}
		} else {
			updateAuthUI();
			if (isOnline) {
				fetchAvailableCourses();
			}
		}
		
	}).catch(error => {
		console.error('Error initializing GAPI client:', error);
		showImprovedNotification('error', 'API Error', 'Failed to initialize Google API.');
		updateAuthUI();
	});
});
}
	/**
	 * Handle token response from Google OAuth.
	 * @param {Object} resp - The token response object.
	 */
function handleTokenResponse(resp) {
console.log('Received token response');

if (resp.error !== undefined) {
	console.error('Token response error:', resp.error);
	showImprovedNotification('error', 'Auth Error', `Authentication error: ${resp.error}`);
	return;
}

if (!resp.access_token) {
	console.error('No access token in response');
	showImprovedNotification('error', 'Auth Error', 'Did not receive access token');
	return;
}

console.log('Access token received, storing token');

try {
	// Store token in localStorage for session persistence
	localStorage.setItem('gapi_token', JSON.stringify(gapi.client.getToken()));
	localStorage.setItem(TOKEN_SCOPE_KEY, 'true');
	
	// User is signed in
	isSignedIn = true;
	
	// Get user info and update UI
	fetchUserInfo().then(() => {
		// Check if user is admin
		isAdmin = currentUser && ADMIN_EMAILS.includes(currentUser.email);
		console.log('User is admin:', isAdmin);
		
		// If this is initial sign-in and user is admin, request elevated permissions
		if (initialSignIn && isAdmin && currentScopes !== ADMIN_SCOPE) {
			console.log('Admin user detected, requesting elevated permissions');
			initialSignIn = false;
			currentScopes = ADMIN_SCOPE;
			
			// Create new token client with admin scopes
			try {
				tokenClient = google.accounts.oauth2.initTokenClient({
					client_id: CLIENT_ID,
					scope: ADMIN_SCOPE,
					callback: handleTokenResponse
				});
				
				// Request token without forcing consent prompt
				tokenClient.requestAccessToken();
				return;
			} catch (error) {
				console.error('Error requesting admin permissions:', error);
			}
		} else if (initialSignIn && !isAdmin && currentScopes !== READONLY_SCOPE) {
			console.log('Non-admin user, using read-only permissions');
			initialSignIn = false;
			currentScopes = READONLY_SCOPE;
			
			try {
				tokenClient = google.accounts.oauth2.initTokenClient({
					client_id: CLIENT_ID,
					scope: READONLY_SCOPE,
					callback: handleTokenResponse
				});
				
				// Request token without forcing consent prompt
				tokenClient.requestAccessToken();
				return;
			} catch (error) {
				console.error('Error requesting read-only permissions:', error);
			}
		}
		
		initialSignIn = false;
		updateAuthUI();
		showImprovedNotification('success', 'Signed In', `Welcome ${currentUser.name}`);
		
		// Continue with your existing code to fetch courses, etc.
		// ...
	}).catch(error => {
		// Your existing error handling code
		// ...
	});
} catch (error) {
	console.error('Error processing token:', error);
	showImprovedNotification('error', 'Auth Error', 'Error during sign-in process');
}
}
	
	/**
	 * Fetch user info (profile) from Google.
	 * @returns {Promise} A promise that resolves when user info is fetched.
	 */
async function fetchUserInfo() {
	try {
		const tokenObj = gapi.client.getToken();
		if (!tokenObj || !tokenObj.access_token) {
			console.error('No valid token available');
			throw new Error('No valid token available');
		}
		
		console.log('Fetching user info with token:', tokenObj.access_token.substring(0, 10) + '...');
		
		const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
			headers: { 'Authorization': `Bearer ${tokenObj.access_token}` }
		});
		
		if (!response.ok) {
			console.error('Failed to fetch user info, status:', response.status);
			throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
		}
		
		const userInfo = await response.json();
		console.log('User info fetched successfully:', userInfo.email);
		
		currentUser = {
			id: userInfo.sub,
			name: userInfo.name || userInfo.email,
			email: userInfo.email,
			picture: userInfo.picture || 'https://via.placeholder.com/32'
		};
		
		// Update user info in UI
		userName.textContent = currentUser.name;
		userAvatar.src = currentUser.picture;
		
		// Check if user is admin
		isAdmin = ADMIN_EMAILS.includes(currentUser.email);
		console.log('User is admin:', isAdmin);
		
		return currentUser;
	} catch (error) {
		console.error('Error fetching user info:', error);
		showImprovedNotification('error', 'User Info Error', error.message || 'Failed to get user information');
		throw error;
	}
}

	/**
	 * Handle auth button click to sign in.
	 */
// Replace your handleAuthClick function with this updated version
function handleAuthClick(e) {
    if (e) e.preventDefault();
    
    console.log('Auth button clicked - redirecting to Google auth');
    
    // Show notification that we're redirecting
    showImprovedNotification('info', 'Signing In', 'Redirecting to Google...');
    
    // Get the exact current URL as redirect URI (very important!)
    const redirectUri = window.location.origin + window.location.pathname;
    console.log('Using redirect URI:', redirectUri);
    
    // Create Google OAuth URL with scopes
    const scopes = encodeURIComponent('openid email profile https://www.googleapis.com/auth/spreadsheets');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
                    `client_id=${CLIENT_ID}&` +
                    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
                    `response_type=token&` +
                    `scope=${scopes}`;
    
    console.log('Auth URL:', authUrl);
    
    // Add a small delay before redirecting to ensure the notification is displayed
    setTimeout(() => {
        // Redirect to Google login
        window.location.href = authUrl;
    }, 100);
}

	
function handleSignoutClick() {
try {
	const token = gapi.client.getToken();
	if (token !== null) {
		console.log('Revoking token and signing out');
		google.accounts.oauth2.revoke(token.access_token, () => {
			gapi.client.setToken('');
			localStorage.removeItem('gapi_token');
			isSignedIn = false;
			isAdmin = false;
			currentUser = null;
			updateAuthUI();
			logs = [];
			uidToNameMap = {};
			updateUI();
			showImprovedNotification('info', 'Signed Out', 'You have been successfully signed out');
		});
	} else {
		// If no token, just clear the UI state
		console.log('No token to revoke, cleaning up state');
		localStorage.removeItem('gapi_token');
		isSignedIn = false;
		isAdmin = false;
		currentUser = null;
		updateAuthUI();
		logs = [];
		uidToNameMap = {};
		updateUI();
	}
} catch (error) {
	console.error('Error during sign out:', error);
	// Force sign-out even if there's an error
	localStorage.removeItem('gapi_token');
	isSignedIn = false;
	isAdmin = false;
	currentUser = null;
	updateAuthUI();
	logs = [];
	uidToNameMap = {};
	updateUI();
}
}

function updateAuthUI() {
    console.log('Updating Auth UI - isSignedIn:', isSignedIn, 'isAdmin:', isAdmin);
    
    // Add class to body to trigger CSS display rules
    document.body.classList.toggle('is-admin', isAdmin);
    
    // Get elements that need direct manipulation
    const loginContainer = document.getElementById('login-container');
    const userContainer = document.getElementById('user-container');
    const tabsContainer = document.querySelector('.tabs');
    const courseButtonsContainer = document.querySelector('.course-buttons-container');
    const scannerModule = document.querySelector('.module');
    
    // Show/hide main containers based on auth state
    if (loginContainer) loginContainer.style.display = isSignedIn ? 'none' : 'flex';
    if (userContainer) userContainer.style.display = isSignedIn ? 'flex' : 'none';
    if (tabsContainer) tabsContainer.style.display = isAdmin ? 'flex' : 'none';
    if (courseButtonsContainer) courseButtonsContainer.style.display = isSignedIn ? 'flex' : 'none';
    
    // Handle scanner and scan buttons
    if (scannerModule) {
        scannerModule.style.display = isSignedIn ? 'block' : 'none';
    }
    
	// Handle scan buttons based on NFC support and user status
	const startScanBtn = document.getElementById('start-scan-btn');
	const stopScanBtn = document.getElementById('stop-scan-btn');

if (startScanBtn && stopScanBtn) {
    // Only show scan buttons if NFC is supported
    if (nfcSupported) {
        // For non-signed in users OR admin users
        if (!isSignedIn || (isSignedIn && isAdmin)) {
            startScanBtn.style.display = isScanning ? 'none' : 'flex';
            stopScanBtn.style.display = isScanning ? 'flex' : 'none';
        } else {
            // For signed-in non-admin users
            startScanBtn.style.display = 'none';
            stopScanBtn.style.display = 'none';
        }
    } else {
        // NFC not supported - hide buttons regardless of user type
        startScanBtn.style.display = 'none';
        stopScanBtn.style.display = 'none';
    }
	updateScanButtons();
}
    
    // Handle guest mode UI
    if (!isSignedIn) {
        // Create or update the not-signed-in message
        let notSignedInMsg = document.getElementById('not-signed-in-message');
        if (!notSignedInMsg) {
            notSignedInMsg = document.createElement('div');
            notSignedInMsg.id = 'not-signed-in-message';
            notSignedInMsg.className = 'not-signed-in-message';
            
            // Insert after the app header
            const appHeader = document.querySelector('.app-header');
            if (appHeader && appHeader.nextSibling) {
                appHeader.parentNode.insertBefore(notSignedInMsg, appHeader.nextSibling.nextSibling);
            } else if (appHeader) {
                appHeader.parentNode.appendChild(notSignedInMsg);
            }
        }
        
        if (lastScannedUID) {
            // Show last scanned UID
            notSignedInMsg.innerHTML = `
                <p><i class="fas fa-id-card"></i> The UID of your ID Card is:</p>
                <h3 style="margin-top: 10px; font-weight: bold; text-transform: uppercase;">${lastScannedUID}</h3>
            `;
        } else {
            // Default welcome message
            notSignedInMsg.innerHTML = `
                <h3><i class="fas fa-info-circle"></i> Welcome to Attendance Tracker</h3>
                <p>Please sign in with your <b>EPOKA Mail</b> to track your attendance.</p>
            `;
        }
        
        // Hide UI elements except scan button
        const logsHeader = document.querySelector('.logs-header');
        const filterContainer = document.querySelector('.filter-container');
        const tableContainer = document.querySelector('.table-container');
        
        if (logsHeader) logsHeader.style.display = 'none';
        if (filterContainer) filterContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'none';
    } else {
        // Remove not-signed-in message if exists
        const notSignedInMsg = document.getElementById('not-signed-in-message');
        if (notSignedInMsg) {
            notSignedInMsg.remove();
        }
        
        // Show UI elements for signed-in users
        const logsHeader = document.querySelector('.logs-header');
        const filterContainer = document.querySelector('.filter-container');
        const tableContainer = document.querySelector('.table-container');
        
        if (logsHeader) logsHeader.style.display = 'flex';
        if (filterContainer) filterContainer.style.display = 'flex';
        if (tableContainer) tableContainer.style.display = 'block';
        
        // Show/hide UID columns based on admin status
        document.querySelectorAll('.uid-column').forEach(col => {
            col.style.display = isAdmin ? 'table-cell' : 'none';
        });
    }
    
    // Update sync button visibility (admin only)
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.disabled = !isOnline || !isSignedIn || isSyncing;
        syncBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }
    
    // Update empty logs message for signed-in users
    const emptyLogs = document.getElementById('empty-logs');
    if (emptyLogs && isSignedIn) {
        if (!currentCourse) {
            emptyLogs.innerHTML = '<i class="fas fa-info-circle"></i> Please select a course to view attendance logs.';
        } else if (logs.length === 0) {
            emptyLogs.innerHTML = '<i class="fas fa-info-circle"></i> No attendance records found for this course.';
        }
    }
}

	/**
	 * Update authentication-dependent UI elements.
	 * Show/hide elements based on sign-in status and admin privileges.
	 */
function updateSortOptions(showName, showDate) {
// Clear existing options
while (sortSelect.options.length > 0) {
	sortSelect.remove(0);
}

// Date options are always available
const dateDescOption = document.createElement('option');
dateDescOption.value = 'date-desc';
dateDescOption.textContent = 'Date (Newest First)';
sortSelect.appendChild(dateDescOption);

const dateAscOption = document.createElement('option');
dateAscOption.value = 'date-asc';
dateAscOption.textContent = 'Date (Oldest First)';
sortSelect.appendChild(dateAscOption);

// Add name options only if specified and admin
if (showName && isAdmin) {
	const nameAscOption = document.createElement('option');
	nameAscOption.value = 'name-asc';
	nameAscOption.textContent = 'Name (A-Z)';
	sortSelect.appendChild(nameAscOption);
	
	const nameDescOption = document.createElement('option');
	nameDescOption.value = 'name-desc';
	nameDescOption.textContent = 'Name (Z-A)';
	sortSelect.appendChild(nameDescOption);
}

// Add UID options only for admin
if (isAdmin) {
	const uidAscOption = document.createElement('option');
	uidAscOption.value = 'uid-asc';
	uidAscOption.textContent = 'UID (A-Z)';
	sortSelect.appendChild(uidAscOption);
	
	const uidDescOption = document.createElement('option');
	uidDescOption.value = 'uid-desc';
	uidDescOption.textContent = 'UID (Z-A)';
	sortSelect.appendChild(uidDescOption);
}

// Set default sort
sortSelect.value = 'date-desc';
currentSort = 'date-desc';
}

function handleCourseChange() {
logs = []; // Clear current logs before loading new ones

if (!currentCourse) {
	updateUI();
	emptyLogs.innerHTML = '<i class="fas fa-info-circle"></i> Please select a course.';
	return;
}

const titleElement = document.querySelector('h1');
if (titleElement) {
	const courseName = currentCourse.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
	titleElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading ${courseName}...`;
}

if (!isSignedIn) {
	// Load logs from local storage for the course
	const storedLogs = localStorage.getItem(`${LOGS_STORAGE_KEY}_${currentCourse}`);
	if (storedLogs) {
		try {
			logs = JSON.parse(storedLogs);
			logs.sort((a, b) => b.timestamp - a.timestamp);
		} catch (e) {
			console.error('Error parsing stored logs:', e);
			logs = [];
		}
	}
	// Update the title when a course is selected
	updatePageTitle(); 
	updateUI();
	return;
}

// When signed in, fetch logs from the spreadsheet
if (isOnline) {
	fetchLogsFromSheet()
		.then(() => {
			updatePageTitle();
			updateUI();
		})
		.catch(error => {
			console.error('Error fetching logs:', error);
			
			// On error, reset title back to default
			const titleElement = document.querySelector('h1');
			if (titleElement) {
				titleElement.innerHTML = `<i class="fa-solid fa-list-check"></i> Attendance`;
			}
			
			// Only show error if we're past initialization
			if (!isInitializing) {
				showImprovedNotification('error', 'Data Error', `Failed to load logs for ${currentCourse}`);
			}
			
			// Fallback to local storage
			const storedLogs = localStorage.getItem(`${LOGS_STORAGE_KEY}_${currentCourse}`);
			if (storedLogs) {
				try {
					logs = JSON.parse(storedLogs);
					logs.sort((a, b) => b.timestamp - a.timestamp);
				} catch (e) {
					console.error('Error parsing stored logs:', e);
				}
			}
			updateUI();
		});
} else {
	// Offline: fallback to local storage
	const storedLogs = localStorage.getItem(`${LOGS_STORAGE_KEY}_${currentCourse}`);
	if (storedLogs) {
		try {
			logs = JSON.parse(storedLogs);
			logs.sort((a, b) => b.timestamp - a.timestamp);
		} catch (e) {
			console.error('Error parsing stored logs:', e);
		}
	}
	updatePageTitle();
	updateUI();
}
}


// Add this helper function to save logs to localStorage
function saveLogsToLocalStorage() {
if (currentCourse) {
	try {
		localStorage.setItem(`${LOGS_STORAGE_KEY}_${currentCourse}`, JSON.stringify(logs));
	} catch (e) {
		console.error('Error saving logs to localStorage:', e);
	}
}
}


	/**
	 * Populate course dropdown with available courses.
	 */
function populateCourseDropdown() {
// Original dropdown code (keep it for backward compatibility)
while (courseSelect.options.length > 1) {
	courseSelect.remove(1);
}

if (!isSignedIn) {
	const defaultOption = document.createElement('option');
	defaultOption.value = 'Default';
	defaultOption.textContent = 'Default';
	courseSelect.appendChild(defaultOption);
	courseSelect.value = 'Default';
	currentCourse = 'Default';
} else {
	availableCourses.forEach(course => {
		const option = document.createElement('option');
		option.value = course;
		option.textContent = course.replace('_', ' ');
		courseSelect.appendChild(option);
	});

	if (currentCourse && availableCourses.includes(currentCourse)) {
		courseSelect.value = currentCourse;
	}
}

// Also populate course buttons
populateCourseButtons();
}


	/**
	 * Update online/offline status indicator.
	 */
function updateOnlineStatus() {
isOnline = navigator.onLine;
console.log('Connection status updated: ' + (isOnline ? 'Online' : 'Offline'));

if (isOnline) {
	syncStatus.className = 'sync-status online';
	syncText.textContent = 'Online';
	// Only disable if not signed in or syncing in progress
	syncBtn.disabled = !isSignedIn || isSyncing;
} else {
	syncStatus.className = 'sync-status offline';
	syncText.textContent = 'Offline';
	syncBtn.disabled = true;
}

// Ensure we show the button for admins regardless
syncBtn.style.display = isAdmin ? 'inline-block' : 'none';

// Debug output to help diagnose the issue
console.log('Sync button state:', {
	isOnline,
	isSignedIn,
	isAdmin,
	isSyncing,
	disabled: syncBtn.disabled,
	display: syncBtn.style.display
});
}
	
	/**
	 * Sync data with Google Sheets.
	 * Fetches and updates both database and logs.
	 */
async function syncData() {
if (!isOnline || !isSignedIn || isSyncing) {
	return;
}

isSyncing = true;

// Show syncing indicator
const syncIcon = syncBtn.querySelector('i');
if (syncIcon) {
	syncIcon.classList.add('fa-spin');
}
syncBtn.disabled = true;

showImprovedNotification('info', 'Syncing', 'Syncing data with Google Sheets...');

try {
	// First sync database to get up-to-date UID-name mappings
	try {
		await fetchDatabaseFromSheet();
	} catch (dbError) {
		console.error('Database sync error:', dbError);
		// Continue with logs sync even if database sync fails
	}
	
	// Then sync logs if a course is selected
	if (currentCourse) {
		await syncLogsWithSheet();
	} else if (availableCourses.length > 0) {
		// If no course selected but courses are available, select the first one
		currentCourse = availableCourses[0];
		courseSelect.value = currentCourse;
		await fetchLogsFromSheet();
	}
	
	showImprovedNotification('success', 'Sync Complete', 'Data has been synced with Google Sheets');
} catch (error) {
	console.error('Sync error:', error);
	showImprovedNotification('error', 'Sync Failed', 'Failed to sync with Google Sheets. Check console for details.');
} finally {
	isSyncing = false;
	
	if (syncIcon) {
		syncIcon.classList.remove('fa-spin');
	}
	
	syncBtn.disabled = !isSignedIn || !isOnline;
	updateUI();
}
}

	/**
	 * Fetch database entries from Google Sheet.
	 * Updates uidToNameMap with the latest data.
	 */
async function fetchDatabaseFromSheet() {
try {
	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId: DATABASE_SPREADSHEET_ID,
		range: 'Database!A2:C'
	});
	
	const rows = response.result.values || [];
	const sheetMappings = {};
	
	// Expecting each row as [Index, Name, UID]
	rows.forEach(row => {
		if (row.length >= 3) {
			const name = row[1];
			const uid = row[2];
			if (name && uid) {
				sheetMappings[uid] = name;
			}
		}
	});
	
	uidToNameMap = sheetMappings;
	updateDatabaseStatus();
	updateDatabaseList();
	console.log(`Loaded ${Object.keys(uidToNameMap).length} entries from database sheet`);
} catch (error) {
	console.error('Error fetching database:', error);
	// Only show error for admin users
	if (!isInitializing && isAdmin) {
		showImprovedNotification('error', 'Database Error', 'Failed to fetch database from Google Sheets');
	}
	throw error;
}
}

function updatePageTitle() {
const titleElement = document.querySelector('h1');
if (!titleElement) return;

if (currentCourse && currentCourse !== 'Default') {
	// Format nicely - replace underscores and capitalize
	const formattedCourse = currentCourse
		.replace(/_/g, ' ')
		.replace(/\b\w/g, l => l.toUpperCase());
	
	titleElement.innerHTML = `<i class="fa-solid fa-list-check"></i> ${formattedCourse} Attendance`;
} else {
	titleElement.innerHTML = `<i class="fa-solid fa-list-check"></i> Attendance`;
}
}
	
	/**
	 * Fetch available courses (sheet names) from logs spreadsheet.
	 */
async function fetchAvailableCourses() {
try {
	console.log('Fetching available courses from spreadsheet...');
	
	if (!isOnline) {
		console.log('Not online or not signed in, using default courses');
		// Default courses if offline or not signed in
		availableCourses = [];
		populateCourseDropdown();
		return;
	}
	
	const response = await gapi.client.sheets.spreadsheets.get({
		spreadsheetId: LOGS_SPREADSHEET_ID
	});
	
	const sheets = response.result.sheets || [];
	availableCourses = sheets.map(sheet => sheet.properties.title);
	
	console.log('Fetched courses:', availableCourses);
	
	// If no courses found, use defaults
	if (availableCourses.length === 0) {
		console.warn('No courses found in spreadsheet, using defaults');
		availableCourses = [];
	}
	
	populateCourseDropdown();
	console.log(`Found ${availableCourses.length} courses in spreadsheet`);
} catch (error) {
	console.error('Error fetching courses:', error);
	
	// Use default courses if fetch fails
	console.log('Using default courses due to error');
	availableCourses = [];
	populateCourseDropdown();
	
	showImprovedNotification('warning', 'Courses Warning', 'Using default course list');
	throw error;
}
}

	/**
	 * Fetch logs from Google Sheet for current course.
	 */
async function fetchLogsFromSheet() {
if (!currentCourse) {
	return;
}

try {
	const response = await gapi.client.sheets.spreadsheets.values.get({
		spreadsheetId: LOGS_SPREADSHEET_ID,
		range: `${currentCourse}!A2:D`,
	});
	
	const rows = response.result.values || [];
	const sheetLogs = [];
	
	rows.forEach(row => {
		if (row.length >= 3) {
			const uid = String(row[0]);
			const timestamp = new Date(row[1]).getTime();
			const id = row[2] || Date.now() + Math.random().toString(36).substr(2, 9);
			const manual = row.length >= 4 ? row[3] === 'true' : false;
			
			if (uid && !isNaN(timestamp)) {
				sheetLogs.push({ uid, timestamp, id, manual });
			}
		}
	});
	
	// Sort logs by timestamp (newest first)
	sheetLogs.sort((a, b) => b.timestamp - a.timestamp);
	logs = sheetLogs;
	
	// Also save to localStorage as backup
	saveLogsToLocalStorage();
	
	console.log(`Loaded ${logs.length} logs from ${currentCourse} sheet`);
	return true;
} catch (error) {
	console.error('Error fetching logs:', error);
	
	// Reset title back to default on error
	const titleElement = document.querySelector('h1');
	if (titleElement) {
		titleElement.innerHTML = `<i class="fas fa-clipboard-list"></i> Attendance`;
	}
	
	if (!isInitializing) {
		showImprovedNotification('error', 'Logs Error', 'Failed to fetch logs from Google Sheets');
	}
	throw error;
}
}
	
function mergeLogs(localLogs, remoteLogs) {
const merged = {};
// Add remote logs first.
remoteLogs.forEach(log => {
	merged[log.id] = log;
});
// For local logs, update only if local has a newer timestamp.
localLogs.forEach(log => {
	if (!merged[log.id] || log.timestamp > merged[log.id].timestamp) {
		merged[log.id] = log;
	}
});
// Return sorted logs (newest first)
return Object.values(merged).sort((a, b) => b.timestamp - a.timestamp);
}


// Helper function to convert a timestamp to a local ISO-like string (without timezone info)
function convertTimestampToLocalISOString(timestamp) {
const date = new Date(timestamp);
const pad = (num) => String(num).padStart(2, '0');
// Build a string like "YYYY-MM-DDTHH:MM:SS"
return date.getFullYear() + '-' +
	   pad(date.getMonth() + 1) + '-' +
	   pad(date.getDate()) + 'T' +
	   pad(date.getHours()) + ':' +
	   pad(date.getMinutes()) + ':' +
	   pad(date.getSeconds());
}

async function syncLogsWithSheet() {
if (!currentCourse || !isAdmin) {
	return;
}

try {
	console.log("Starting sync with spreadsheet...");
	// Show syncing indicator on the sync button
	const syncIcon = syncBtn.querySelector('i');
	if (syncIcon) {
		syncIcon.classList.add('fa-spin');
	}
	isSyncing = true;
	
	// Prepare the data for the spreadsheet using the universal timestamp conversion.
	const sheetData = logs.map(log => [
		log.uid,
		convertTimestampToLocalISOString(log.timestamp),
		log.id,
		log.manual ? 'true' : 'false'
	]);
	
	console.log(`Syncing ${sheetData.length} logs to spreadsheet...`);
	
	// Clear existing data in the target range
	await gapi.client.sheets.spreadsheets.values.clear({
		spreadsheetId: LOGS_SPREADSHEET_ID,
		range: `${currentCourse}!A2:D`,
	});
	
	// Write the new data if there is any
	if (sheetData.length > 0) {
		await gapi.client.sheets.spreadsheets.values.update({
			spreadsheetId: LOGS_SPREADSHEET_ID,
			range: `${currentCourse}!A2:D`,
			valueInputOption: 'RAW',
			resource: { values: sheetData }
		});
	}
	
	console.log(`Successfully synced ${logs.length} logs with ${currentCourse} sheet`);
} catch (error) {
	console.error('Error syncing logs:', error);
	showImprovedNotification('error', 'Sync Error', 'Failed to sync logs with Google Sheets');
	throw error;
} finally {
	// Remove syncing indicator
	const syncIcon = syncBtn.querySelector('i');
	if (syncIcon) {
		syncIcon.classList.remove('fa-spin');
	}
	isSyncing = false;
}
}

	
	/**
	 * Sync database (UID-name map) to Google Sheets.
	 */
async function syncDatabaseToSheet() {
// Only allow sync if the user is signed in as admin.
if (!isSignedIn || !isAdmin || !isOnline) {
	console.warn('Database sync aborted: Not signed in as admin or not online.');
	return;
}

try {
	const entries = Object.entries(uidToNameMap);
	// Format data as [Index, Name, UID]
	const sheetData = entries.map(([uid, name], index) => [
		index + 1,
		name,
		uid
	]);
	
	// Clear existing data in the range
	await gapi.client.sheets.spreadsheets.values.clear({
		spreadsheetId: DATABASE_SPREADSHEET_ID,
		range: 'Database!A2:C'
	});
	
	// Write new data if there are entries
	if (sheetData.length > 0) {
		await gapi.client.sheets.spreadsheets.values.update({
			spreadsheetId: DATABASE_SPREADSHEET_ID,
			range: 'Database!A2:C',
			valueInputOption: 'RAW',
			resource: { values: sheetData }
		});
	}
	
	console.log(`Synced ${entries.length} database entries to sheet`);
} catch (error) {
	console.error('Error syncing database:', error);
	showImprovedNotification('error', 'Sync Error', 'Failed to sync database with Google Sheets');
	throw error;
}
}

 
	/**
	 * Append a single log to Google Sheet (for immediate sync).
	 * @param {Object} log - The log entry to append.
	 */
async function appendLogToSheet(log) {
if (!currentCourse || !isOnline || !isSignedIn) {
	return;
}

try {
	await gapi.client.sheets.spreadsheets.values.append({
		spreadsheetId: LOGS_SPREADSHEET_ID,
		range: `${currentCourse}!A2:D`,
		valueInputOption: 'RAW',
		insertDataOption: 'INSERT_ROWS',
		resource: {
			values: [[
				log.uid,
				new Date(log.timestamp).toISOString(),
				log.id,
				log.manual ? 'true' : 'false'
			]]
		}
	});
	
	console.log('Log appended to Google Sheet');
} catch (error) {
	console.error('Error appending log:', error);
	showImprovedNotification('warning', 'Sync Warning', 'Failed to sync log immediately. Will sync on next full sync.');
}
}

	/**
	 * Update sort icons in the table headers.
	 */
function updateSortIcons() {
// Reset all sort icons
document.querySelectorAll('.sort-icon').forEach(icon => {
	icon.className = 'sort-icon fas fa-sort';
});

// Set sort icon for current sort field
const [field, direction] = currentSort.split('-');
const header = document.querySelector(`.sortable[data-sort="${field}"]`);

if (header) {
	const icon = header.querySelector('.sort-icon');
	icon.className = `sort-icon fas fa-sort-${direction === 'asc' ? 'up' : 'down'}`;
}
}
	

	
	/**
	 * Handle filter input change for logs.
	 */
function handleFilterChange() {
filter = filterInput.value.toLowerCase();
updateLogsList();
}
	
	/**
	 * Handle sort dropdown change for logs.
	 */
function handleSortChange() {
currentSort = sortSelect.value;
updateSortIcons();
updateLogsList();
}
	
	/**
	 * Handle filter input change for database.
	 */
function handleDbFilterChange() {
dbFilter = dbFilterInput.value.toLowerCase();
updateDatabaseList();
}
	
	/**
	 * Add new database entry.
	 */
function showAddEntryDialog() {
if (!isAdmin) return;

// Prompt for UID and name
const uid = prompt("Enter UID for new entry:");
if (uid === null) return;

const trimmedUid = uid.trim();
if (!trimmedUid) {
	alert("UID cannot be empty.");
	return;
}

if (uidToNameMap[trimmedUid]) {
	alert("This UID already exists in the database.");
	return;
}

const name = prompt("Enter name for UID " + trimmedUid + ":");
if (name === null) return;

const trimmedName = name.trim();
if (!trimmedName) {
	alert("Name cannot be empty.");
	return;
}

// Add to database
uidToNameMap[trimmedUid] = trimmedName;

// Sync to sheet if online
if (isOnline && isSignedIn) {
	syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
}

updateUI();
showImprovedNotification('success', 'Entry Added', `Added ${trimmedName} (${trimmedUid}) to the database.`);
}

	/**
	 * Edit database entry (change name).
	 * @param {string} uid - The UID of the entry to edit.
	 */
function editDatabaseEntry(uid) {
if (!isAdmin) return;

const currentName = uidToNameMap[uid] || '';
const newName = prompt(`Enter a new name for ${uid}:`, currentName);

if (newName === null) return;

const trimmed = newName.trim();
if (!trimmed) {
	alert('Name cannot be empty.');
	return;
}

uidToNameMap[uid] = trimmed;

// Sync to sheet if online
if (isOnline && isSignedIn) {
	syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
}

updateUI();
showImprovedNotification('success', 'Entry Updated', `Updated ${uid} to ${trimmed} in the database.`);
}

	/**
	 * Delete database entry.
	 * @param {string} uid - The UID of the entry to delete.
	 */
function deleteDatabaseEntry(uid) {
if (!isAdmin) return;

const name = uidToNameMap[uid];
if (!name) return;

if (confirm(`Are you sure you want to delete "${name}" (${uid}) from the database?`)) {
	delete uidToNameMap[uid];
	
	// Sync to sheet if online
	if (isOnline && isSignedIn) {
		syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
	}
	
	updateUI();
	showImprovedNotification('success', 'Entry Deleted', `Removed ${name} (${uid}) from the database.`);
}
}
	
	/**
	 * Clear the entire database.
	 */
function clearDatabase() {
if (!isAdmin) return;

if (confirm('Are you sure you want to clear the entire database? This will remove all UID-name mappings.')) {
	uidToNameMap = {};
	
	// Sync to sheet if online
	if (isOnline && isSignedIn) {
		syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
	}
	
	updateUI();
	showImprovedNotification('success', 'Database Cleared', 'All database entries have been removed.');
}
}

	/**
	 * Add manual log entry.
	 */
function showAddLogEntryDialog() {
if (!isAdmin) return;

if (!currentCourse) {
	showImprovedNotification('warning', 'No Course Selected', 'Please select a course before adding a log entry');
	return;
}

// Create dialog for adding a manual log entry
const dialogBackdrop = document.createElement('div');
dialogBackdrop.className = 'dialog-backdrop';

const dialog = document.createElement('div');
dialog.className = 'dialog';

// Get current date and time for default values
const now = new Date();
const formattedDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
const formattedTime = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

// Build options for known people from database
let nameOptions = '';
const sortedEntries = Object.entries(uidToNameMap).sort((a, b) => a[1].localeCompare(b[1]));

sortedEntries.forEach(([uid, name]) => {
	nameOptions += `<option value="${uid}">${name} (${uid})</option>`;
});

dialog.innerHTML = `
	<h3 class="dialog-title">Add Manual Log Entry</h3>
	<div class="form-group">
		<label for="manual-name">Person:</label>
		<select id="manual-name" class="form-control">
			<option value="">-- Select Person --</option>
			${nameOptions}
		</select>
	</div>
	<div class="form-group">
		<label for="manual-date">Date:</label>
		<input type="date" id="manual-date" class="form-control" value="${formattedDate}">
	</div>
	<div class="form-group">
		<label for="manual-time">Time:</label>
		<input type="time" id="manual-time" class="form-control" value="${formattedTime}">
	</div>
	<div class="dialog-actions">
		<button id="save-manual-log-btn" class="btn-green">Add Entry</button>
		<button id="cancel-manual-btn">Cancel</button>
	</div>
`;

dialogBackdrop.appendChild(dialog);
document.body.appendChild(dialogBackdrop);

// Handle save button
document.getElementById('save-manual-log-btn').addEventListener('click', function() {
	const selectedUid = document.getElementById('manual-name').value;
	const manualDate = document.getElementById('manual-date').value;
	const manualTime = document.getElementById('manual-time').value;
	
	if (!selectedUid) {
		alert('Please select a person.');
		return;
	}
	
	if (!manualDate) {
		alert('Please enter a date.');
		return;
	}
	
	if (!manualTime) {
		alert('Please enter a time.');
		return;
	}
	
	// Create new log entry
	const timestamp = new Date(`${manualDate}T${manualTime}:00`);
	const newLog = {
		uid: selectedUid,
		timestamp: timestamp.getTime(),
		id: Date.now() + Math.random().toString(36).substr(2, 9),
		manual: true
	};
	
	// Add to logs
	logs.unshift(newLog);
	
	// Sync with sheets if online
	if (isOnline && isSignedIn) {
		appendLogToSheet(newLog).catch(err => console.error('Error appending log:', err));
	}
	
	updateUI();
	
	const name = uidToNameMap[selectedUid] || 'Unknown';
	showImprovedNotification('success', 'Manual Entry Added', `Added attendance for ${name} at ${manualDate} ${manualTime}`);
	
	document.body.removeChild(dialogBackdrop);
});

// Handle cancel button
document.getElementById('cancel-manual-btn').addEventListener('click', function() {
	document.body.removeChild(dialogBackdrop);
});
}

	/**
	 * Show dialog to edit a log entry group.
	 * @param {Object} group - The log group to edit.
	 */
function showEditLogDialog(group) {
if (!isAdmin) return;

// Create dialog backdrop
const dialogBackdrop = document.createElement('div');
dialogBackdrop.className = 'dialog-backdrop';

// Create dialog box
const dialog = document.createElement('div');
dialog.className = 'dialog';

// Get date from first log in group
const firstLog = group.originalLogs[0];
const commonDateObj = new Date(firstLog.timestamp);
const formattedDate = commonDateObj.toISOString().split('T')[0];

// Create timestamp edit fields for each log in group
let timestampFields = '';
group.originalLogs.forEach((log, index) => {
	const timeObj = new Date(log.timestamp);
	const formattedTime = timeObj.toTimeString().split(' ')[0].substring(0, 5);
	
	timestampFields += `
		<div class="timestamp-edit-group" data-log-id="${log.id}">
			<div style="display: flex; justify-content: space-between; align-items: center;">
				<h4>Timestamp ${index + 1}</h4>
				<button class="delete-time-btn btn-red" style="padding: 2px 8px; font-size: 0.8em;" data-index="${index}">
					<i class="fas fa-trash"></i> Delete
				</button>
			</div>
			<div class="form-group">
				<label>Time:</label>
				<input type="time" class="form-control timestamp-time" value="${formattedTime}">
			</div>
		</div>
	`;
});

dialog.innerHTML = `
	<h3 class="dialog-title">Edit Log Entry</h3>
	<div class="form-group">
		<label for="edit-name">Name:</label>
		<input type="text" id="edit-name" class="form-control" value="${group.name}">
		<small style="color: #777; display: block; margin-top: 5px;">This will update the database for this UID</small>
	</div>
	<div class="form-group">
		<label for="edit-uid">UID:</label>
		<input type="text" id="edit-uid" class="form-control" value="${group.uid}" disabled>
	</div>
	<div class="form-group">
		<label>Date:</label>
		<input type="date" id="edit-date" class="form-control" value="${formattedDate}">
	</div>
	<div id="timestamp-container">
		${timestampFields}
	</div>
	<div class="dialog-actions">
		<button id="save-edit-log-btn" class="btn-blue">Save</button>
		<button id="cancel-edit-log-btn" class="btn-red">Cancel</button>
	</div>
`;

// Add some custom styling
const style = document.createElement('style');
style.textContent = `
	.timestamp-edit-group {
		background-color: #f9f9f9;
		padding: 10px;
		border-radius: 5px;
		margin-bottom: 10px;
	}
	.timestamp-edit-group h4 {
		margin-top: 0;
		margin-bottom: 10px;
		color: #3949ab;
	}
	.timestamp-edit-group.deleted {
		display: none;
	}
`;

dialog.appendChild(style);
dialogBackdrop.appendChild(dialog);
document.body.appendChild(dialogBackdrop);

// Track logs to delete
const logsToDelete = new Set();

// Handle delete time buttons
dialog.querySelectorAll('.delete-time-btn').forEach(btn => {
	btn.addEventListener('click', function() {
		const index = parseInt(this.getAttribute('data-index'));
		const logId = group.originalLogs[index].id;
		const timestampGroup = this.closest('.timestamp-edit-group');
		
		// Count visible timestamp groups (not deleted)
		const visibleGroups = dialog.querySelectorAll('.timestamp-edit-group:not(.deleted)').length;
		
		// Don't allow deleting the last timestamp
		if (visibleGroups <= 1) {
			showImprovedNotification('warning', 'Cannot Delete', 'At least one timestamp must remain.');
			return;
		}
		
		// Mark for deletion
		logsToDelete.add(logId);
		timestampGroup.classList.add('deleted');
		
		showImprovedNotification('info', 'Timestamp Marked for Deletion', 'The timestamp will be deleted when you save changes.');
	});
});

// Handle save button
document.getElementById('save-edit-log-btn').addEventListener('click', function() {
	const newName = document.getElementById('edit-name').value.trim();
	const newDate = document.getElementById('edit-date').value;
	
	if (!newName) {
		alert('Name cannot be empty.');
		return;
	}
	
	// Update name in database
	uidToNameMap[group.uid] = newName;
	
	// Update each log in the group
	const visibleGroups = dialog.querySelectorAll('.timestamp-edit-group:not(.deleted)');
	
	visibleGroups.forEach(groupElement => {
		const logId = groupElement.getAttribute('data-log-id');
		const timeInput = groupElement.querySelector('.timestamp-time').value;
		
		// Find the corresponding log
		const log = logs.find(log => log.id === logId);
		
		if (log) {
			// Update timestamp with new date and time
			const newTimestamp = new Date(`${newDate}T${timeInput}:00`);
			log.timestamp = newTimestamp.getTime();
		}
	});
	
	// Remove logs marked for deletion
	if (logsToDelete.size > 0) {
		logs = logs.filter(log => !logsToDelete.has(log.id));
	}
	
	// Sort logs by timestamp
	logs.sort((a, b) => b.timestamp - a.timestamp);
	
	// Sync with sheets if online
	if (isOnline && isSignedIn) {
		Promise.all([
			syncDatabaseToSheet(),
			syncLogsWithSheet()
		]).catch(err => console.error('Error syncing after edit:', err));
	}
	
	updateUI();
	
	showImprovedNotification('success', 'Log Updated', 'Log entry has been updated successfully.');
	document.body.removeChild(dialogBackdrop);
});

// Handle cancel button
document.getElementById('cancel-edit-log-btn').addEventListener('click', function() {
	document.body.removeChild(dialogBackdrop);
});
}

	/**
	 * Delete a log group.
	 * @param {Object} group - The log group to delete.
	 */
function confirmDeleteLog(group) {
if (!isAdmin) return;

if (confirm(`Are you sure you want to delete all log entries for ${group.name} on ${group.date}?`)) {
	// Get IDs of all logs in this group
	const idsToRemove = group.originalLogs.map(log => log.id);
	
	// First remove the logs locally
	logs = logs.filter(log => !idsToRemove.includes(log.id));
	
	// Save to localStorage
	saveLogsToLocalStorage();
	
	// Update UI immediately
	updateUI();
	
	// Track deletion in progress to prevent refetching
	const deletionInProgress = true;
	
	// Sync with sheets if online and admin
	if (isOnline && isSignedIn && isAdmin) {
		// Disable buttons during sync
		clearBtn.disabled = true;
		exportBtn.disabled = true;
		
		syncLogsWithSheet()
			.then(() => {
				showImprovedNotification('success', 'Logs Deleted', `Removed all logs for ${group.name} on ${group.date}`);
			})
			.catch(err => {
				console.error('Error syncing after delete:', err);
				showImprovedNotification('error', 'Sync Error', 'Changes saved locally but not synced to spreadsheet');
			})
			.finally(() => {
				// Re-enable buttons
				clearBtn.disabled = logs.length === 0;
				exportBtn.disabled = logs.length === 0;
			});
	} else {
		showImprovedNotification('success', 'Logs Deleted', `Removed all logs for ${group.name} on ${group.date}`);
	}
}
}

function clearLogs() {
if (!isAdmin) return;
if (!confirm('Are you sure you want to delete ALL logs?')) return;

// First clear logs locally
logs = [];
saveLogsToLocalStorage();
updateUI();

if (isOnline && isSignedIn) {
	// Disable buttons during sync
	clearBtn.disabled = true;
	exportBtn.disabled = true;
	
	syncLogsWithSheet()
		.then(() => {
			showImprovedNotification('success', 'Logs Cleared', 'All logs have been removed from the spreadsheet.');
		})
		.catch(err => {
			console.error('Error clearing logs:', err);
			showImprovedNotification('error', 'Clear Error', 'Failed to remove logs from the spreadsheet.');
		})
		.finally(() => {
			// Force UI update again to ensure logs stay cleared
			logs = [];
			updateUI();
		});
}
}

// Deletes a single log by its ID and then syncs the changes.
function deleteLogEntry(logId) {
if (!isAdmin) return; // Only admins can delete.
// Remove the log with the given ID.
logs = logs.filter(log => log.id !== logId);
if (isOnline && isSignedIn) {
	syncLogsWithSheet()
		.then(() => {
			showImprovedNotification('success', 'Log Deleted', 'Successfully removed the log from the spreadsheet.');
			updateUI();
		})
		.catch(err => {
			console.error('Error deleting log:', err);
			showImprovedNotification('error', 'Delete Error', 'Failed to remove the log from the spreadsheet.');
		});
} else {
	updateUI();
}
}
	
	/**
	 * Handle file selection for Excel import.
	 * @param {Event} event - The change event from the file input.
	 */
function handleExcelFile(event) {
if (!isAdmin) return;

const file = event.target.files[0];
if (!file) return;

const reader = new FileReader();

reader.onload = function(e) {
	try {
		const data = new Uint8Array(e.target.result);
		const workbook = XLSX.read(data, { type: 'array' });
		
		// Get the first sheet
		const firstSheetName = workbook.SheetNames[0];
		const worksheet = workbook.Sheets[firstSheetName];
		
		// Convert to JSON
		const jsonData = XLSX.utils.sheet_to_json(worksheet);
		
		// Extract UID-name mappings
		const excelMappings = {};
		
		jsonData.forEach(row => {
			// Get first two columns (name and UID)
			const keys = Object.keys(row);
			
			if (keys.length >= 2) {
				const name = row[keys[0]];
				const uid = String(row[keys[1]]);
				
				if (name && uid) {
					excelMappings[uid] = name;
				}
			}
		});
		
		const excelCount = Object.keys(excelMappings).length;
		
		if (excelCount === 0) {
			showImprovedNotification('error', 'Import Failed', 'Could not find name and UID data in the expected columns.');
			return;
		}
		
		// Show import dialog
		showDatabaseImportDialog(excelMappings);
	} catch (error) {
		console.error('Excel import error:', error);
		showImprovedNotification('error', 'Import Failed', 'Could not process the Excel file.');
	}
};

reader.onerror = function() {
	showImprovedNotification('error', 'Import Failed', 'Failed to read the Excel file.');
};

reader.readAsArrayBuffer(file);

// Reset the file input
event.target.value = '';
}

	/**
	 * Show import dialog for database Excel data.
	 * @param {Object} excelMappings - The UID-name mappings from Excel.
	 */
function showDatabaseImportDialog(excelMappings) {
const dialogBackdrop = document.createElement('div');
dialogBackdrop.className = 'dialog-backdrop';

const dialog = document.createElement('div');
dialog.className = 'dialog';

dialog.innerHTML = `
	<h3 class="dialog-title">Import UID Database</h3>
	<p>Found ${Object.keys(excelMappings).length} entries in the Excel file.</p>
	<p>How would you like to import them?</p>
	<div class="dialog-actions">
		<button id="merge-db-btn" class="btn-blue">Merge</button>
		<button id="replace-db-btn" class="btn-blue">Replace</button>
		<button id="cancel-db-import-btn" class="btn-red">Cancel</button>
	</div>
`;

dialogBackdrop.appendChild(dialog);
document.body.appendChild(dialogBackdrop);

// Merge option
document.getElementById('merge-db-btn').addEventListener('click', () => {
	// Add new mappings without overwriting existing ones
	let newCount = 0;
	
	for (const [uid, name] of Object.entries(excelMappings)) {
		if (!uidToNameMap[uid]) {
			uidToNameMap[uid] = name;
			newCount++;
		}
	}
	
	// Sync to sheet if online
	if (isOnline && isSignedIn) {
		syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
	}
	
	updateUI();
	showImprovedNotification('success', 'Database Merged', `Added ${newCount} new entries to the database.`);
	document.body.removeChild(dialogBackdrop);
});

// Replace option
document.getElementById('replace-db-btn').addEventListener('click', () => {
	uidToNameMap = { ...excelMappings };
	
	// Sync to sheet if online
	if (isOnline && isSignedIn) {
		syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
	}
	
	updateUI();
	showImprovedNotification('success', 'Database Replaced', `Database now contains ${Object.keys(excelMappings).length} entries from Excel.`);
	document.body.removeChild(dialogBackdrop);
});

// Cancel import
document.getElementById('cancel-db-import-btn').addEventListener('click', () => {
	document.body.removeChild(dialogBackdrop);
});
}

	/**
	 * Handle file selection for logs JSON import.
	 * @param {Event} event - The change event from the file input.
	 */
function handleImportFile(event) {
if (!isAdmin) return;

if (!currentCourse) {
	showImprovedNotification('warning', 'No Course Selected', 'Please select a course before importing logs');
	return;
}

const file = event.target.files[0];
if (!file) return;

const reader = new FileReader();

reader.onload = function(e) {
	try {
		const importedLogs = JSON.parse(e.target.result);
		
		if (!Array.isArray(importedLogs)) {
			throw new Error('Invalid format: Logs must be an array');
		}
		
		// Normalize timestamps to milliseconds and ensure IDs
		importedLogs.forEach(log => {
			if (log.timestamp) {
				try {
					log.timestamp = new Date(log.timestamp).getTime();
					
					if (isNaN(log.timestamp)) {
						console.warn(`Invalid timestamp: ${log.timestamp}`);
						log.timestamp = Date.now();
					}
				} catch (err) {
					console.warn(`Error parsing timestamp: ${err}`);
					log.timestamp = Date.now();
				}
			} else {
				log.timestamp = Date.now();
			}
			
			// Ensure each log has an ID
			if (!log.id) {
				log.id = Date.now() + Math.random().toString(36).substr(2, 9);
			}
		});
		
		// Show import dialog
		showImportDialog(importedLogs);
	} catch (error) {
		showImprovedNotification('error', 'Import Failed', 'The selected file is not a valid logs file.');
		console.error('Import error:', error);
	}
};

reader.onerror = function() {
	showImprovedNotification('error', 'Import Failed', 'Failed to read the file.');
};

reader.readAsText(file);

// Reset the file input
event.target.value = '';
}

	/**
	 * Show import dialog for logs.
	 * @param {Array} importedLogs - The logs to import.
	 */
function showImportDialog(importedLogs) {
// Create dialog backdrop
const dialogBackdrop = document.createElement('div');
dialogBackdrop.className = 'dialog-backdrop';

// Create dialog box
const dialog = document.createElement('div');
dialog.className = 'dialog';

dialog.innerHTML = `
	<h3 class="dialog-title">Import Logs</h3>
	<p>Imported ${importedLogs.length} log entries. How would you like to proceed?</p>
	<div class="dialog-actions">
		<button id="merge-logs-btn" class="btn-blue">Merge with Existing</button>
		<button id="replace-logs-btn" class="btn-red">Replace All</button>
		<button id="cancel-import-btn">Cancel</button>
	</div>
`;

dialogBackdrop.appendChild(dialog);
document.body.appendChild(dialogBackdrop);

// Merge option
document.getElementById('merge-logs-btn').addEventListener('click', () => {
	// Create map of existing log IDs
	const existingIds = new Set(logs.map(log => log.id));
	
	// Add only new logs
	let newCount = 0;
	
	importedLogs.forEach(log => {
		if (!existingIds.has(log.id)) {
			logs.push(log);
			newCount++;
		}
	});
	
	// Sort logs by timestamp
	logs.sort((a, b) => b.timestamp - a.timestamp);
	
	// Sync with sheets if online
	if (isOnline && isSignedIn) {
		syncLogsWithSheet().catch(err => console.error('Error syncing logs:', err));
	}
	
	updateUI();
	showImprovedNotification('success', 'Import Complete', `Added ${newCount} new log entries.`);
	document.body.removeChild(dialogBackdrop);
});

// Replace option
document.getElementById('replace-logs-btn').addEventListener('click', () => {
	logs = [...importedLogs];
	logs.sort((a, b) => b.timestamp - a.timestamp);
	
	// Sync with sheets if online
	if (isOnline && isSignedIn) {
		syncLogsWithSheet().catch(err => console.error('Error syncing logs:', err));
	}
	
	updateUI();
	showImprovedNotification('success', 'Import Complete', `Replaced logs with ${importedLogs.length} imported entries.`);
	document.body.removeChild(dialogBackdrop);
});

// Cancel option
document.getElementById('cancel-import-btn').addEventListener('click', () => {
	document.body.removeChild(dialogBackdrop);
});
}

	/**
	 * Export logs to JSON file.
	 */
function exportLogs() {
if (logs.length === 0) {
	showImprovedNotification('warning', 'Export Failed', 'No logs to export');
	return;
}

// Format timestamps for export
const exportData = logs.map(log => ({
	...log,
	timestamp: new Date(log.timestamp).toISOString()
}));

// Create download link
const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
const downloadAnchor = document.createElement('a');
downloadAnchor.setAttribute("href", dataStr);
downloadAnchor.setAttribute("download", `${currentCourse || 'attendance'}_logs.json`);

// Trigger download
document.body.appendChild(downloadAnchor);
downloadAnchor.click();
document.body.removeChild(downloadAnchor);

showImprovedNotification('success', 'Export Complete', 'Logs exported to JSON file');
}

	/**
	 * Export database to Excel file.
	 */
function exportDatabaseToExcel() {
const entries = Object.entries(uidToNameMap);

if (entries.length === 0) {
	showImprovedNotification('warning', 'Export Failed', 'No database entries to export');
	return;
}

// Create worksheet data
const wsData = [["Name", "UID"]]; // header

entries.sort((a, b) => a[1].localeCompare(b[1])).forEach(([uid, name]) => {
	wsData.push([name, uid]);
});

// Create worksheet
const worksheet = XLSX.utils.aoa_to_sheet(wsData);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "Database");

// Generate Excel file
XLSX.writeFile(workbook, "uid_database.xlsx");

showImprovedNotification('success', 'Export Complete', 'Database exported to Excel file');
}

	/**
	 * Update the filtered and sorted logs list in the UI.
	 */
// Fixed updateLogsList function without the illegal continue statement
function updateLogsList() {
// If no course selected, show message
if (!currentCourse) {
	emptyLogs.style.display = 'block';
	filteredCount.textContent = '0';
	logsTbody.innerHTML = '';
	return;
}

// Filter logs based on search input
const filteredLogs = filter 
	? logs.filter(log => {
		// Match UID
		if (log.uid.toLowerCase().includes(filter)) {
			return true;
		}
		// Match name if in database
		const name = uidToNameMap[log.uid];
		if (name && name.toLowerCase().includes(filter)) {
			return true;
		}
		return false;
	})
	: logs;

// Group logs by date and UID
const grouped = {};

filteredLogs.forEach(log => {
	// Get date object
	const dateObj = new Date(log.timestamp);
	
	if (isNaN(dateObj.getTime())) {
		console.warn('Invalid timestamp:', log.timestamp);
		return;
	}
	
	// Format date for display (DD-MM-YYYY)
	const day = String(dateObj.getDate()).padStart(2, '0');
	const month = String(dateObj.getMonth() + 1).padStart(2, '0');
	const year = dateObj.getFullYear();
	const date = `${day}-${month}-${year}`;
	
	const uid = log.uid;
	const time = dateObj.toLocaleTimeString();
	const name = uidToNameMap[uid] || 'Unknown';
	
	// Create key for date and UID combination
	const key = `${date}_${uid}`;
	
	if (!grouped[key]) {
		grouped[key] = {
			date,
			dateObj: new Date(year, month - 1, day), // For sorting
			uid,
			name,
			times: [],
			timeObjs: [], // Store time objects for sorting
			originalLogs: [] // Store original log references for edit/delete
		};
	}
	
	grouped[key].times.push(time);
	grouped[key].timeObjs.push(dateObj.getTime());
	grouped[key].originalLogs.push(log);
});

// Convert to array
let result = Object.values(grouped);

// Apply sort based on currentSort value
const [field, direction] = currentSort.split('-');
const sortMultiplier = direction === 'asc' ? 1 : -1;

switch (field) {
	case 'date':
		// First sort by date
		result.sort((a, b) => sortMultiplier * (a.dateObj - b.dateObj));
		
		// Now group entries by date
		const dateGroups = {};
		result.forEach(entry => {
			const dateStr = entry.date;
			if (!dateGroups[dateStr]) {
				dateGroups[dateStr] = [];
			}
			dateGroups[dateStr].push(entry);
		});
		
		// Sort each date group by name or UID depending on user role
		Object.keys(dateGroups).forEach(dateStr => {
			if (isSignedIn && !isAdmin) {
				// For non-admin signed-in users, sort by name
				dateGroups[dateStr].sort((a, b) => a.name.localeCompare(b.name));
			} else if (!isSignedIn) {
				// For non-signed-in users, sort by UID
				dateGroups[dateStr].sort((a, b) => a.uid.localeCompare(b.uid));
			} else {
				// For admins, sort by name first, then by earliest time
				dateGroups[dateStr].sort((a, b) => {
					const nameCompare = a.name.localeCompare(b.name);
					if (nameCompare !== 0) return nameCompare;
					const aEarliestTime = Math.min(...a.timeObjs);
					const bEarliestTime = Math.min(...b.timeObjs);
					return aEarliestTime - bEarliestTime;
				});
			}
		});
		
		// Reconstruct result based on sorted dates
		result = [];
		const dates = Object.keys(dateGroups).sort((a, b) => {
			const dateA = new Date(a.split('-').reverse().join('-'));
			const dateB = new Date(b.split('-').reverse().join('-'));
			return sortMultiplier * (dateA - dateB);
		});
		
		dates.forEach(dateStr => {
			result = result.concat(dateGroups[dateStr]);
		});
		break;
		
	case 'name':
		result.sort((a, b) => sortMultiplier * a.name.localeCompare(b.name));
		break;
	case 'uid':
		result.sort((a, b) => sortMultiplier * a.uid.localeCompare(b.uid));
		break;
	default:
		result.sort((a, b) => -1 * (a.dateObj - b.dateObj));
}

// Update filtered count
filteredCount.textContent = filteredLogs.length;

// Show/hide empty message
emptyLogs.style.display = filteredLogs.length > 0 ? 'none' : 'block';

// Clear the table body
logsTbody.innerHTML = '';

// Track current day for separators
let currentDay = null;

// Add grouped logs to table with day separators
result.forEach((group) => {
	// Check if we need to add a day separator
	if (currentSort.startsWith('date')) {
		const thisDay = group.date;
		if (thisDay !== currentDay) {
			currentDay = thisDay;
			// Show day separators for all signed-in users
			if (isSignedIn) {
				const separatorRow = document.createElement('tr');
				separatorRow.className = 'day-separator';
				const separatorCell = document.createElement('td');
				separatorCell.colSpan = isAdmin ? 5 : 3; // Different colspan for admin/non-admin
				separatorCell.innerHTML = `<i class="fas fa-calendar-day"></i> ${group.date}`;
				separatorRow.appendChild(separatorCell);
				logsTbody.appendChild(separatorRow);
			}
		}
	}
	
	// Create log entry row
	const row = document.createElement('tr');
	
	if (!isSignedIn) {
		// For non-signed-in users, we only show UID and Time
		// UID cell
		const uidCell = document.createElement('td');
		uidCell.className = 'uid-cell uid-column';
		uidCell.textContent = group.uid;
		row.appendChild(uidCell);
		
		// Time cell
		const timesCell = document.createElement('td');
		timesCell.className = 'times-cell';
		const sortedIndices = group.timeObjs
			.map((timeObj, index) => ({ timeObj, index }))
			.sort((a, b) => a.timeObj - b.timeObj)
			.map(item => item.index);
		sortedIndices.forEach(index => {
			const timeTag = document.createElement('span');
			timeTag.className = 'time-tag';
			timeTag.textContent = group.times[index];
			timesCell.appendChild(timeTag);
		});
		row.appendChild(timesCell);
		
		logsTbody.appendChild(row);
	} 
	else {
		// For signed-in users (both admin and non-admin)
		
		// Name cell - always visible for signed-in users
		const nameCell = document.createElement('td');
		nameCell.className = 'name-cell name-column';
		nameCell.textContent = group.name;
if (group.originalLogs.some(log => log.manual)) {
    // Create the excused icon
    const excusedIcon = document.createElement('i');
    excusedIcon.className = 'fa-solid fa-circle-info excused-icon';
    // Add click event listener to show a notification
    excusedIcon.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event from bubbling up
        showImprovedNotification(
            'info', 
            'Excused Absence', 
            'This attendance record was <b>manually added</b> as an excused absence.'
        );
    });
    
    // Add the icon to the name cell
    nameCell.appendChild(document.createTextNode(' ')); // Add space
    nameCell.appendChild(excusedIcon);
}
		row.appendChild(nameCell);
		
		// UID cell - only for admin
		if (isAdmin) {
			const uidCell = document.createElement('td');
			uidCell.className = 'uid-cell uid-column';
			uidCell.textContent = group.uid;
			row.appendChild(uidCell);
			
			// Date cell - only for admin
			const dateCell = document.createElement('td');
			dateCell.className = 'date-cell date-column';
			dateCell.textContent = group.date;
			row.appendChild(dateCell);
		}
		
		// Times cell
		const timesCell = document.createElement('td');
		timesCell.className = 'times-cell';
		const sortedIndices = group.timeObjs
			.map((timeObj, index) => ({ timeObj, index }))
			.sort((a, b) => a.timeObj - b.timeObj)
			.map(item => item.index);
		sortedIndices.forEach(index => {
			const timeTag = document.createElement('span');
			timeTag.className = 'time-tag';
			timeTag.textContent = group.times[index];
			timesCell.appendChild(timeTag);
		});
		row.appendChild(timesCell);
		
		// Actions cell for admin users only
		if (isAdmin) {
			const actionsCell = document.createElement('td');
			actionsCell.className = 'actions-cell';
			
			const editIcon = document.createElement('i');
			editIcon.className = 'fas fa-edit action-icon edit-icon';
			editIcon.title = 'Edit';
			editIcon.addEventListener('click', () => showEditLogDialog(group));
			
			const deleteIcon = document.createElement('i');
			deleteIcon.className = 'fas fa-trash-alt action-icon delete-icon';
			deleteIcon.title = 'Delete';
			deleteIcon.addEventListener('click', () => confirmDeleteLog(group));
			
			actionsCell.appendChild(editIcon);
			actionsCell.appendChild(deleteIcon);
			row.appendChild(actionsCell);
		}
		
		logsTbody.appendChild(row);
	}
});
}        
	/**
	 * Update the database list in the UI.
	 */
function updateDatabaseList() {
// Filter database entries
const entries = Object.entries(uidToNameMap)
	.filter(([uid, name]) => {
		if (!dbFilter) return true;
		return (
			uid.toLowerCase().includes(dbFilter) ||
			name.toLowerCase().includes(dbFilter)
		);
	})
	.sort((a, b) => a[1].localeCompare(b[1])); // Sort by name

// Update entry count
dbEntryCount.textContent = Object.keys(uidToNameMap).length;

// Show/hide empty message
emptyDatabase.style.display = Object.keys(uidToNameMap).length > 0 ? 'none' : 'block';

// Clear table
databaseTbody.innerHTML = '';

// Add entries to table
entries.forEach(([uid, name]) => {
	const row = document.createElement('tr');
	
	// Name cell
	const nameCell = document.createElement('td');
	nameCell.className = 'name-cell';
	nameCell.textContent = name;
	
	// UID cell
	const uidCell = document.createElement('td');
	uidCell.className = 'uid-cell';
	uidCell.textContent = uid;
	
	row.appendChild(nameCell);
	row.appendChild(uidCell);
	
	// Actions cell (admin only)
	if (isAdmin) {
		const actionsCell = document.createElement('td');
		actionsCell.className = 'actions-cell';
		
		// Edit button
		const editIcon = document.createElement('i');
		editIcon.className = 'fas fa-edit action-icon edit-icon';
		editIcon.title = 'Edit';
		editIcon.addEventListener('click', () => editDatabaseEntry(uid));
		
		// Delete button
		const deleteIcon = document.createElement('i');
		deleteIcon.className = 'fas fa-trash-alt action-icon delete-icon';
		deleteIcon.title = 'Delete';
		deleteIcon.addEventListener('click', () => deleteDatabaseEntry(uid));
		
		actionsCell.appendChild(editIcon);
		actionsCell.appendChild(deleteIcon);
		row.appendChild(actionsCell);
	}
	
	databaseTbody.appendChild(row);
});
}

	/**
	 * Update database status indicator.
	 */
function updateDatabaseStatus() {
const count = Object.keys(uidToNameMap).length;
databaseStatus.textContent = count > 0 ? `${count} entries` : 'Not loaded';
}

	/**
	 * Update the entire UI.
	 */
function updateUI() {
updateLogsList();
updateDatabaseList();
updateDatabaseStatus();
updatePageTitle();

// Update total scans and last scan info
totalScans.textContent = logs.length;

if (logs.length > 0) {
	const latestLog = logs.reduce((latest, log) => 
		log.timestamp > latest.timestamp ? log : latest, logs[0]);
		
	const lastTimestamp = new Date(latestLog.timestamp);
	lastScan.textContent = lastTimestamp.toLocaleString();
} else {
	lastScan.textContent = 'Never';
}

// Enable/disable buttons
exportBtn.disabled = logs.length === 0;
clearBtn.disabled = logs.length === 0;

if (isAdmin) {
	// Admin-specific UI updates
	clearDbBtn.disabled = Object.keys(uidToNameMap).length === 0;
	exportExcelBtn.disabled = Object.keys(uidToNameMap).length === 0;
	
	// Update scan buttons based on scanning state
	if (isScanning) {
		startScanBtn.style.display = 'none';
		stopScanBtn.style.display = 'flex';
	} else {
		startScanBtn.style.display = 'flex';
		stopScanBtn.style.display = 'none';
	}
}
populateCourseButtons();
}

	/**
	 * Start NFC scanning.
	 */
async function startScanning() {
if (!nfcSupported) {
// Only show the notification if the user is on a mobile device.
if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
	showImprovedNotification('error', 'NFC Not Supported', 'NFC scanning is only supported in Chrome on Android.');
}
return;
}


if (!currentCourse) {
	showImprovedNotification('warning', 'No Course Selected', 'Please select a course before scanning');
	return;
}

try {
	// Show scanning notification
	showImprovedNotification('info', 'Starting scanner', 'Requesting permission to use NFC...');
	
	// Create NFC reader
	nfcReader = new NDEFReader();
	
	// Request permission and start scan
	nfcReader.scan().then(() => {
		// Scan started successfully
		isScanning = true;
		updateScanButtons();
		showImprovedNotification('success', 'Scanner active', 'Ready to scan NFC tags');
		
		// Set up event listeners
		nfcReader.addEventListener("reading", handleNfcReading);
		nfcReader.addEventListener("error", handleNfcError);
	}).catch(error => {
		handleScanningError(error);
	});
} catch (error) {
	handleScanningError(error);
}
}

function handleScanningError(error) {
// Handle permission denied and other errors
let errorMessage = error.message;
let errorTitle = 'Scanner error';

if (error.name === 'NotAllowedError' || errorMessage.includes('permission')) {
	errorTitle = 'Permission denied';
	errorMessage = 'You need to grant permission to use NFC. Please try again.';
} else if (error.name === 'NotSupportedError') {
	errorTitle = 'NFC not supported';
	errorMessage = 'Your device doesn\'t support NFC or it\'s turned off.';
}

showImprovedNotification('error', errorTitle, errorMessage);
stopScanning();
}

function updateScanButtons() {
    console.log('Updating scan buttons - NFC supported:', nfcSupported);
    
    // Get references to buttons to ensure we have the latest elements
    const startScanBtn = document.getElementById('start-scan-btn');
    const stopScanBtn = document.getElementById('stop-scan-btn');
    
    if (!startScanBtn || !stopScanBtn) {
        console.warn('Scan buttons not found in the DOM');
        return;
    }
    
    // Always hide buttons first if NFC is not supported
    if (!nfcSupported) {
        console.log('NFC not supported - hiding all scan buttons');
        startScanBtn.style.display = 'none';
        stopScanBtn.style.display = 'none';
        return;
    }
    
    // If NFC is supported, handle button visibility based on user role
    console.log('NFC supported - updating buttons based on user role');
    console.log('isSignedIn:', isSignedIn, 'isAdmin:', isAdmin, 'isScanning:', isScanning);
    
    if (isScanning) {
        // When scanning, only show stop button
        startScanBtn.style.display = 'none';
        stopScanBtn.style.display = 'flex';
    } else {
        // Only show START button for non-signed-in users OR admin users
        if (!isSignedIn || (isSignedIn && isAdmin)) {
            startScanBtn.style.display = 'flex';
        } else {
            startScanBtn.style.display = 'none';
        }
        stopScanBtn.style.display = 'none';
    }
}

	
	/**
	 * Handle NFC reading.
	 * @param {Object} event - The NFC reading event.
	 */
async function handleNfcReading({ serialNumber }) {
lastScannedUID = serialNumber;
// For non-signed-in users, only show UID without saving anything
if (!isSignedIn) {
	// Play success sound
	playSound(true);
	
	// Update the welcome message to show the UID
	let notSignedInMsg = document.getElementById('not-signed-in-message');
	if (notSignedInMsg) {
		notSignedInMsg.innerHTML = `
			<h3><i class="fas fa-id-card"></i> The serial number of your Student ID Card is:</h3>
			<h3 style="margin-top: 10px; font-weight: bold;">${lastScannedUID}</h3>
		`;
	}
	
	// Show success notification
	/* showImprovedNotification('success', 'Tag scanned', 
		`<b>UID:</b> ${serialNumber}<br><br>` +
		`<b>Sign in with your EPOKA account to track attendance.</b>`);*/
	return;
}

// Standard flow for signed-in users
if (!currentCourse) {
	showImprovedNotification('warning', 'No Course Selected', 'Please select a course before scanning');
	return;
}

// Create log entry
const timestamp = new Date();
const newLog = {
	uid: serialNumber,
	timestamp: timestamp.getTime(),
	id: Date.now() + Math.random().toString(36).substr(2, 9),
	manual: false
};

// Add to logs
logs.unshift(newLog);

// Save to localStorage
saveLogsToLocalStorage();

// Update UI
updateUI();

// Determine name for notification
const name = uidToNameMap[serialNumber] || 'Unknown';

// Play success sound
playSound(true);

// Show success notification
showImprovedNotification('success', 'Tag scanned', `Name: ${name}<br>UID: ${serialNumber}`);

// If online and signed in as admin, append log to sheet
if (isOnline && isSignedIn && isAdmin) {
	try {
		await appendLogToSheet(newLog);
		console.log('Log synced successfully');
	} catch (err) {
		console.error('Error appending log:', err);
		showImprovedNotification('warning', 'Sync Warning', 'Failed to sync immediately');
	}
}
}

	
	/**
	 * Handle NFC error.
	 * @param {Object} error - The NFC error.
	 */
function handleNfcError(error) {
// Play error sound
playSound(false);

showImprovedNotification('error', 'Scanner error', error.message);
stopScanning();
}
	
	/**
	 * Stop NFC scanning.
	 */
function stopScanning() {
isScanning = false;
updateScanButtons();

// There's no official way to abort scanning, but we can remove the reader
if (nfcReader) {
	nfcReader.removeEventListener("reading", handleNfcReading);
	nfcReader.removeEventListener("error", handleNfcError);
	nfcReader = null;
}

showImprovedNotification('info', 'Scanner stopped', 'NFC scanning has been stopped.');
}

	/**
	 * Play sound effect (success or error).
	 * @param {boolean} success - Whether to play success or error sound.
	 */
function playSound(success) {
if (!soundEnabled) return;

try {
	if (success) {
		successSound.currentTime = 0;
		successSound.play().catch(e => console.error("Error playing sound:", e));
	} else {
		errorSound.currentTime = 0;
		errorSound.play().catch(e => console.error("Error playing sound:", e));
	}
} catch (e) {
	console.error("Error playing sound:", e);
}
}

	/**
	 * Update current year in footer.
	 */
function updateYear() {
	const yearElement = document.getElementById('currentYear');
	if (yearElement) {
		yearElement.textContent = new Date().getFullYear();
	}
}

	
function showImprovedNotification(type, title, message, duration) {
// Skip redundant notifications
if (title === 'Courses Warning' && message === 'Using default course list') {
	return;
}

// Skip Auth Errors during initialization
if (isInitializing && title === 'Auth Error') {
	return;
}

// Skip User Info errors that often resolve themselves
if (title === 'User Info Error' || message.includes('user info')) {
	return;
}

// During initialization, only show critical notifications immediately
if (isInitializing || criticalErrorsOnly) {
	const isCritical = type === 'error' && 
					  (title.includes('Critical') || 
					   message.includes('Permission denied'));
	
	if (!isCritical) {
		// Store non-critical notifications for later
		pendingNotifications.push({type, title, message, duration});
		return;
	}
}

// Safely remove notifications
const safeRemove = (element) => {
	try {
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}
	} catch (e) {
		console.log('Error removing notification:', e);
	}
};

// Clear existing notifications of the same type
const existingNotifications = notificationArea.querySelectorAll(`.in-page-notification-${type}`);
existingNotifications.forEach(notification => {
	notification.classList.add('removing');
	setTimeout(() => safeRemove(notification), 300);
});

// Limit total notifications to 2
const allNotifications = notificationArea.querySelectorAll('.in-page-notification');
if (allNotifications.length >= 2) {
	const oldest = allNotifications[0];
	oldest.classList.add('removing');
	setTimeout(() => safeRemove(oldest), 300);
}

// Create the new notification
const notification = document.createElement('div');
notification.className = `in-page-notification in-page-notification-${type}`;

let icon;
switch(type) {
	case 'success': icon = 'check-circle'; break;
	case 'error': icon = 'times-circle'; break;
	case 'warning': icon = 'exclamation-circle'; break;
	default: icon = 'info-circle';
}

notification.innerHTML = `
	<i class="fas fa-${icon}"></i>
	<div style="flex-grow:1;">
		<strong>${title}</strong><br>
		${message}
	</div>
	<button class="notification-close">&times;</button>
`;

notificationArea.appendChild(notification);

// Add click handler to close button
const closeBtn = notification.querySelector('.notification-close');
if (closeBtn) {
	closeBtn.addEventListener('click', function(e) {
		e.preventDefault();
		e.stopPropagation();
		notification.classList.add('removing');
		setTimeout(() => safeRemove(notification), 300);
	});
}

// Auto-remove non-error notifications
if (type !== 'error') {
	setTimeout(() => {
		notification.classList.add('removing');
		setTimeout(() => safeRemove(notification), 300);
	}, duration || 5000);
}
}

function populateCourseButtons() {
// Get button container
const courseButtonsContainer = document.getElementById('course-buttons-container');
if (!courseButtonsContainer) return;

// Hide the whole container if not signed in
if (!isSignedIn) {
	courseButtonsContainer.style.display = 'none';
	return;
} else {
	courseButtonsContainer.style.display = 'flex';
}

// Clear existing buttons
courseButtonsContainer.innerHTML = '';

// For signed-in users, add buttons for all available courses
availableCourses.forEach(course => {
	const button = document.createElement('div');
	button.className = 'course-button' + (currentCourse === course ? ' active' : '');
	button.innerHTML = `<i class="fas fa-th-list"></i>&nbsp; ${course.replace('_', ' ')}`;
	button.addEventListener('click', () => {
		selectCourseButton(course);
	});
	courseButtonsContainer.appendChild(button);
});

// If no course selected but courses available, select first one
if (!currentCourse && availableCourses.length > 0) {
	selectCourseButton(availableCourses[0]);
}
}

function selectCourseButton(course) {
currentCourse = course;

// Update active button visually
document.querySelectorAll('.course-button').forEach(btn => {
	btn.classList.remove('active');
	const btnTextContent = btn.textContent.trim().replace(/\s+/g, ' ');
	const courseDisplay = course.replace('_', ' ');
	
	if (btnTextContent.includes(courseDisplay)) {
		btn.classList.add('active');
	}
});

// Update page title
updatePageTitle();

// Load course data
handleCourseChange();
}
	
// Initialize the application when window loads
window.addEventListener('load', function() {
// Initialize the app UI first
init();

// Wait longer before initializing Google API to ensure all scripts are loaded
setTimeout(() => {
	if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
		initGoogleApi();
	} else {
		console.warn('Google API objects not available yet, waiting longer...');
		
		// Try again with a longer timeout
		setTimeout(() => {
			if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
				console.log('Google API objects loaded after extended wait');
				initGoogleApi();
			} else {
				console.error('Google API objects still not available after extended wait');
				showImprovedNotification('error', 'API Error', 'Google API libraries not loaded. Please check your internet connection or try using a different browser.');
				availableCourses = [];
				populateCourseDropdown();
				updateAuthUI();
			}
		}, 3000);
	}
}, 2000);
});
