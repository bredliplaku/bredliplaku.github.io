// Configuration for the exam system
const CONFIG = {
    // Google API settings
    CLIENT_ID: '740588046540-npg0crodtcuinveu6bua9rd6c3hb2s1m.apps.googleusercontent.com',
    API_KEY: 'AIzaSyD295FTtMHvXxZablRf0f-FR-IQ2dQRPQE',
    
    // Spreadsheet IDs
    EXAM_CONFIG_SPREADSHEET_ID: '14SgW9V3ZLYDqqoAutkvHEuLvcogpJ2hMEj_qj72wmEw',
    SUBMISSIONS_SPREADSHEET_ID: '14SgW9V3ZLYDqqoAutkvHEuLvcogpJ2hMEj_qj72wmEw',
    
    // Sheet names
    EXAM_CONFIG_SHEET: 'ExamConfig',
    SUBMISSIONS_SHEET: 'Submissions',
    
    // Admin emails (allowed to access admin dashboard)
    ADMIN_EMAILS: ['bplaku@epoka.edu.al'],
    
    // Session timeout (in milliseconds)
    SESSION_TIMEOUT: 20 * 60 * 1000, // 20 minutes
    
    // Auto-sync interval (in milliseconds)
    SYNC_INTERVAL: 2 * 60 * 1000, // 2 minutes
};