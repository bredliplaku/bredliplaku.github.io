// sheets-api-service.js
// A service class to handle Google Sheets API operations

class SheetsApiService {
    constructor(config) {
        this.config = config;
        this.initialized = false;
    }

    /**
     * Initialize the API client
     */
    async initialize() {
        if (this.initialized) return;

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
            
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Failed to initialize Sheets API:', error);
            throw error;
        }
    }

    /**
     * Get user profile information
     */
    async getUserProfile() {
        try {
            await this.ensureInitialized();
            const response = await gapi.client.oauth2.userinfo.get();
            return response.result;
        } catch (error) {
            console.error('Failed to get user profile:', error);
            throw error;
        }
    }

    /**
     * Ensure the API client is initialized
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * Get all exams from the config spreadsheet
     */
    async getExams() {
        try {
            await this.ensureInitialized();
            
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID,
                range: `${this.config.EXAM_CONFIG_SHEET}!A2:F`
            });
            
            const values = response.result.values || [];
            
            return values.map((row, index) => ({
                id: index + 2, // +2 because we're starting from row 2 and spreadsheet is 1-indexed
                title: row[0] || '',
                code: row[1] || '',
                instructor: row[2] || '',
                date: row[3] || '',
                duration: parseInt(row[4]) || 0,
                deadline: row[5] || ''
            }));
        } catch (error) {
            console.error('Failed to get exams:', error);
            throw error;
        }
    }

    /**
     * Get questions for a specific exam
     */
    async getExamQuestions(examId) {
        try {
            await this.ensureInitialized();
            
            // Get the exam row from the spreadsheet
            const examResponse = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID,
                range: `${this.config.EXAM_CONFIG_SHEET}!A${examId}:F${examId}`
            });
            
            const examData = examResponse.result.values?.[0] || [];
            const examCode = examData[1]; // Column B is code
            
            // Get questions for this exam code
            const questionsResponse = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID,
                range: `${this.config.EXAM_CONFIG_SHEET}!A:E` // Get all columns with question data
            });
            
            const allRows = questionsResponse.result.values || [];
            
            // Filter rows that are questions for this exam (assuming questions follow exam config row)
            const questionRows = [];
            let foundExam = false;
            
            for (const row of allRows) {
                if (foundExam && row[0] && typeof row[0] === 'string' && !row[0].startsWith('Quiz')) {
                    // This appears to be a question row
                    questionRows.push({
                        type: row[0] || 'text',
                        text: row[1] || '',
                        points: parseInt(row[2]) || 0,
                        options: row[3] ? row[3].split('|') : []
                    });
                } else if (row[1] === examCode) {
                    // Found the exam row
                    foundExam = true;
                } else if (foundExam && row[0] && row[0].startsWith('Quiz')) {
                    // Found the next exam, stop adding questions
                    break;
                }
            }
            
            return questionRows;
        } catch (error) {
            console.error('Failed to get exam questions:', error);
            throw error;
        }
    }

    /**
     * Create a new exam
     */
    async createExam(examData) {
        try {
            await this.ensureInitialized();
            
            const response = await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID,
                range: `${this.config.EXAM_CONFIG_SHEET}!A:F`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [examData]
                }
            });
            
            return response.result;
        } catch (error) {
            console.error('Failed to create exam:', error);
            throw error;
        }
    }

    /**
     * Update an existing exam
     */
    async updateExam(examId, examData) {
        try {
            await this.ensureInitialized();
            
            const response = await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID,
                range: `${this.config.EXAM_CONFIG_SHEET}!A${examId}:F${examId}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [examData]
                }
            });
            
            return response.result;
        } catch (error) {
            console.error('Failed to update exam:', error);
            throw error;
        }
    }

    /**
     * Delete an exam
     */
    async deleteExam(examId) {
        try {
            await this.ensureInitialized();
            
            // Get spreadsheet metadata to find sheet ID
            const spreadsheet = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID
            });
            
            const sheets = spreadsheet.result.sheets || [];
            const sheet = sheets.find(s => s.properties.title === this.config.EXAM_CONFIG_SHEET);
            
            if (!sheet) {
                throw new Error(`Sheet ${this.config.EXAM_CONFIG_SHEET} not found`);
            }
            
            const sheetId = sheet.properties.sheetId;
            
            // Delete the row
            const response = await gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.config.EXAM_CONFIG_SPREADSHEET_ID,
                resource: {
                    requests: [
                        {
                            deleteDimension: {
                                range: {
                                    sheetId: sheetId,
                                    dimension: 'ROWS',
                                    startIndex: examId - 1, // 0-indexed
                                    endIndex: examId // exclusive
                                }
                            }
                        }
                    ]
                }
            });
            
            return response.result;
        } catch (error) {
            console.error('Failed to delete exam:', error);
            throw error;
        }
    }

    /**
     * Get all submissions
     */
    async getSubmissions() {
        try {
            await this.ensureInitialized();
            
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.SUBMISSIONS_SPREADSHEET_ID,
                range: `${this.config.SUBMISSIONS_SHEET}!A:Z` // Get all columns
            });
            
            const values = response.result.values || [];
            
            if (values.length <= 1) {
                // Only header row or empty
                return [];
            }
            
            // Assume first row is header
            const headers = values[0];
            
            // Map each row to an object
            return values.slice(1).map(row => {
                const submission = {};
                
                // Map standard fields
                submission.id = row[0] || '';
                submission.studentName = row[1] || '';
                submission.studentId = row[2] || '';
                submission.studentEmail = row[3] || '';
                submission.timestamp = row[4] || '';
                submission.examTitle = row[5] || '';
                submission.examCode = row[6] || '';
                submission.duration = row[7] || '';
                submission.fingerprint = row[8] || '{}';
                
                // Map answers
                submission.answers = {};
                for (let i = 9; i < row.length; i++) {
                    if (headers[i]) {
                        submission.answers[headers[i]] = row[i] || '';
                    } else {
                        submission.answers[`field_${i}`] = row[i] || '';
                    }
                }
                
                return submission;
            });
        } catch (error) {
            console.error('Failed to get submissions:', error);
            throw error;
        }
    }

    /**
     * Get submissions for a specific exam
     */
    async getExamSubmissions(examCode) {
        try {
            const allSubmissions = await this.getSubmissions();
            return allSubmissions.filter(s => s.examCode === examCode);
        } catch (error) {
            console.error('Failed to get exam submissions:', error);
            throw error;
        }
    }

    /**
     * Get submissions for a specific student
     */
    async getStudentSubmissions(studentId) {
        try {
            const allSubmissions = await this.getSubmissions();
            return allSubmissions.filter(s => s.studentId === studentId);
        } catch (error) {
            console.error('Failed to get student submissions:', error);
            throw error;
        }
    }

    /**
     * Save a partial submission (for syncing)
     */
    async savePartialSubmission(submissionData) {
        try {
            await this.ensureInitialized();
            
            // Check if this submission ID already exists
            const existingSubmissions = await this.getSubmissions();
            const existingSubmission = existingSubmissions.find(s => s.id === submissionData.id);
            
            if (existingSubmission) {
                // Update existing submission
                // Find the row number
                const rowIndex = existingSubmissions.indexOf(existingSubmission) + 2; // +2 for header row and 1-indexing
                
                await gapi.client.sheets.spreadsheets.values.update({
                    spreadsheetId: this.config.SUBMISSIONS_SPREADSHEET_ID,
                    range: `${this.config.SUBMISSIONS_SHEET}!A${rowIndex}:Z${rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    resource: {
                        values: [this.formatSubmissionForSheet(submissionData)]
                    }
                });
            } else {
                // Add new submission
                await gapi.client.sheets.spreadsheets.values.append({
                    spreadsheetId: this.config.SUBMISSIONS_SPREADSHEET_ID,
                    range: `${this.config.SUBMISSIONS_SHEET}!A:Z`,
                    valueInputOption: 'USER_ENTERED',
                    resource: {
                        values: [this.formatSubmissionForSheet(submissionData)]
                    }
                });
            }
            
            return true;
        } catch (error) {
            console.error('Failed to save partial submission:', error);
            throw error;
        }
    }

    /**
     * Format submission data for spreadsheet
     */
    formatSubmissionForSheet(submission) {
        const row = [
            submission.id || '',
            submission.studentName || '',
            submission.studentId || '',
            submission.studentEmail || '',
            submission.timestamp || new Date().toISOString(),
            submission.examTitle || '',
            submission.examCode || '',
            submission.duration || '',
            JSON.stringify(submission.fingerprint || {})
        ];
        
        // Add answers
        if (submission.answers) {
            Object.values(submission.answers).forEach(answer => {
                if (typeof answer === 'object' && answer !== null) {
                    // For file uploads, just store metadata
                    row.push(`[FILE] ${answer.filename} (${answer.size || 0} bytes)`);
                } else {
                    row.push(String(answer || ''));
                }
            });
        }
        
        return row;
    }
}

// Export the service
window.SheetsApiService = SheetsApiService;