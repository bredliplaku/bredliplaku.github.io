// This is your primary website URL
const ALLOWED_ORIGIN = "https://bredliplaku.com";
// The name of the sheet where new registrations arrive
const REGISTRATION_SHEET_NAME = "Registrations";
// The name of the sheet with your official, approved database
const DATABASE_SHEET_NAME = "Database";

// This is your central database that will be used by all log sheets.
const DATABASE_SPREADSHEET_ID = "1jgVSIOQFJv4qiILiT1j33Lr6igp0IhEkIWDg_yQUn8c";

const FALLBACK_GLOBAL_ADMINS = ['bplaku@epoka.edu.al'];

const APP_NAME = "Smart Attendance";

const ATTACHMENTS_FOLDER_ID = "1gg38P37WRnlqDX_Jy5VWC_0ajZM51f5s";

const STAFF_SHEET_NAME = "STAFF_KEYS";
const DEVICES_SHEET_NAME = "TRUSTED_DEVICES";
const KIOSK_TOKEN_PREFIX = "KIOSK_";
const SESSION_DURATION = 1800; // 30 mins

// --- CONFIGURATION MAP ---
const COURSE_COLUMN_MAP = {
    "course": "courseName",
    "start_date": "startDate",
    "end_date": "endDate",
    "holiday_weeks": "holidayWeeks",
    "holiday_start_date": "holidayStartDate",
    "default_hours": "defaultHours",
    "eis_id": "eisId",
    "admin_emails": "adminEmails",
    "available_sections": "availableSections" // Replaces category/section
};

/**
 * Handle NFC Login
 * 1. Checks STAFF_KEYS for UID.
 * 2. If found, issues a short-lived token.
 * 3. If not found, returns specific "not_admin" status.
 */
function loginWithNfc(uid, deviceId) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
        if (!staffSheet) throw new Error("Missing STAFF_KEYS sheet");

        const staff = staffSheet.getDataRange().getValues();
        let userEmail = null;
        let userName = null;
        let userRole = 'Student'; // Default to Student if role is empty

        // 1. Search for UID
        for (let i = 1; i < staff.length; i++) {
            const rowUid = String(staff[i][1]).trim().toLowerCase();
            if (rowUid === String(uid).trim().toLowerCase()) {
                userEmail = staff[i][2];
                userName = staff[i][0];
                // Column D (Index 3) is Role. Use it if present.
                if (staff[i][3]) userRole = String(staff[i][3]).trim();
                break;
            }
        }

        // Not found in Staff Keys? Return standard "guest/student" signal
        if (!userEmail) {
            return { result: "not_admin", message: "UID not recognized as staff." };
        }

        // 2. Security Check (SKIP FOR STUDENTS)
        // Only Lecturers and Global Admins need trusted devices
        if (userRole !== 'Student') {
            const deviceSheet = ss.getSheetByName(DEVICES_SHEET_NAME);
            if (!deviceSheet) throw new Error("Missing TRUSTED_DEVICES sheet");

            const devices = deviceSheet.getDataRange().getValues();
            const cleanDevice = String(deviceId).trim().toLowerCase();

            const isDeviceTrusted = devices.slice(1).some(row =>
                String(row[1]).trim().toLowerCase() === cleanDevice
            );

            if (!isDeviceTrusted) {
                return { result: "error", message: "Device not trusted. Sign in with Google to register this device." };
            }
        }

        // 3. Success - Generate Token
        const sessionToken = KIOSK_TOKEN_PREFIX + Utilities.getUuid();
        // Cache the session
        CacheService.getScriptCache().put(sessionToken, userEmail, SESSION_DURATION);

        return {
            result: "success",
            token: sessionToken,
            user: {
                email: userEmail,
                name: userName,
                picture: "https://ui-avatars.com/api/?name=" + encodeURIComponent(userName) + "&background=random"
            }
        };

    } catch (e) {
        Logger.log("Login Error: " + e.message);
        return { result: "error", message: e.message };
    }
}

function getGlobalSettingsData(userEmail) {
    const status = checkUserAdminStatus(DATABASE_SPREADSHEET_ID, userEmail);

    if (!status.isGlobalAdmin) {
        throw new Error("Permission denied");
    }

    const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);

    // Get Staff
    const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
    let staffList = [];
    if (staffSheet) {
        const data = staffSheet.getDataRange().getValues();
        staffList = data.slice(1).map((row, i) => ({
            rowIndex: i + 2,
            name: row[0],
            uid: row[1],
            email: row[2],
            role: row[3] || 'Student' // Default to Student if empty
        }));
    }

    // Get Devices
    const devSheet = ss.getSheetByName(DEVICES_SHEET_NAME);
    let deviceList = [];
    if (devSheet) {
        const data = devSheet.getDataRange().getValues();
        deviceList = data.slice(1).map((row, i) => ({
            rowIndex: i + 2,
            name: row[0],
            id: row[1],
            owner: row[2],
            date: row[3] instanceof Date ? row[3].toISOString().split('T')[0] : row[3]
        }));
    }

    return { staff: staffList, devices: deviceList };
}

function registerDevice_Admin(data, userEmail) {
    const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(DEVICES_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(DEVICES_SHEET_NAME);
        sheet.appendRow(["Device Name", "Device ID", "Registered By", "Date"]);
    }

    // Check if exists
    const values = sheet.getDataRange().getValues();
    const exists = values.slice(1).some(row => String(row[1]) === data.deviceId);

    if (exists) return { result: "error", message: "Device already registered." };

    sheet.appendRow([data.deviceName, data.deviceId, userEmail, new Date()]);
    return { result: "success" };
}

function manageStaff_Admin(data) {
    const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(STAFF_SHEET_NAME);

    if (!sheet) {
        sheet = ss.insertSheet(STAFF_SHEET_NAME);
        sheet.appendRow(["Name", "UID", "Email", "Role"]);
    }

    // Default to 'Student' if undefined
    let role = 'Student';
    if (data.role === 'Global') role = 'Global';
    if (data.role === 'Lecturer') role = 'Lecturer';

    if (data.actionType === 'add') {
        sheet.appendRow([data.name, data.uid, data.email, role]);
    }
    else if (data.actionType === 'delete') {
        sheet.deleteRow(parseInt(data.rowIndex));
    }
    else if (data.actionType === 'edit') {
        const rowIndex = parseInt(data.rowIndex);
        if (rowIndex > 1) {
            sheet.getRange(rowIndex, 1).setValue(data.name);
            sheet.getRange(rowIndex, 2).setValue(data.uid);
            sheet.getRange(rowIndex, 3).setValue(data.email);
            sheet.getRange(rowIndex, 4).setValue(role);
        }
    }
    return { result: "success" };
}

/**
 * Check admin access
 */
function checkAdminAccess(logsSpreadsheetId, courseName, userEmail) {
    if (!userEmail) return { hasAccess: false, level: 'none', reason: 'No email' };

    // Reuse the logic we just wrote
    const status = checkUserAdminStatus(logsSpreadsheetId, userEmail);

    if (status.isGlobalAdmin) {
        return { hasAccess: true, level: 'global', courses: ['*'] };
    }

    if (status.courses.some(c => c.toLowerCase() === courseName.toLowerCase())) {
        return { hasAccess: true, level: 'course', courses: [courseName] };
    }

    return { hasAccess: false, level: 'none', reason: 'Not authorized for this course' };
}

function doGet(e) {
    try {
        if (!e || !e.parameter) {
            throw new Error('No parameters provided');
        }

        const accessToken = e.parameter.access_token;
        if (!accessToken || accessToken === 'undefined' || accessToken === 'null') {
            throw new Error('No valid access token provided');
        }

        const userEmail = validateToken(accessToken);
        const action = e.parameter.action;
        const courseName = e.parameter.courseName;
        const logsSpreadsheetId = e.parameter.logsSpreadsheetId;

        let resultData;
        switch (action) {
            case "getBootData":
                resultData = getBootData(logsSpreadsheetId, userEmail);
                break;
            case "checkAdminStatus":
                resultData = checkUserAdminStatus(logsSpreadsheetId, userEmail);
                break;
            case "getDatabase":
                resultData = getDatabase();
                break;
            case "getAvailableCourses":
                resultData = getAvailableCourses(logsSpreadsheetId, userEmail);
                break;
            case "getCourseLogs_Admin":
                resultData = getCourseLogs_Admin(courseName, logsSpreadsheetId, userEmail);
                break;
            case "getStudentLogs":
                resultData = getStudentLogs(courseName, logsSpreadsheetId, userEmail);
                break;
            case "getPendingRegistrations":
                // This check now confirms the user is an admin of *any* course.
                const adminStatus = checkUserAdminStatus(logsSpreadsheetId, userEmail);
                if (!adminStatus.isAdmin) {
                    throw new Error('Authorization Error: You do not have admin privileges.');
                }
                resultData = getPendingRegistrations(logsSpreadsheetId, courseName || '');
                break;
            case "getPendingAbsences":
                const adminAccessForAbsence = checkAdminAccess(logsSpreadsheetId, courseName || '', userEmail);
                if (!adminAccessForAbsence.hasAccess) {
                    throw new Error('Authorization Error: You are not an admin.');
                }
                resultData = getPendingAbsences(logsSpreadsheetId, userEmail);
                break;
            case "getStudentAbsenceRequests":
                resultData = getStudentAbsenceRequests(logsSpreadsheetId, userEmail);
                break;
            case "getCourseInfo":
                resultData = getCourseInfo(logsSpreadsheetId);
                break;
            case "getAbsenceHistory_Admin":
                resultData = getAbsenceHistory_Admin(logsSpreadsheetId, userEmail);
                break;
            default:
                throw new Error(`Invalid GET action requested: ${action}`);
        }

        if (resultData && resultData.result === 'error') throw new Error(resultData.message);

        return ContentService.createTextOutput(JSON.stringify(resultData))
            .setMimeType(ContentService.MimeType.TEXT);

    } catch (error) {
        Logger.log(`doGet Error: ${error.message}`);
        return ContentService.createTextOutput(JSON.stringify({ result: "error", message: error.message }))
            .setMimeType(ContentService.MimeType.TEXT);
    }
}

function doPost(e) {
    let requestData;
    try {
        if (!e || !e.postData || !e.postData.contents) {
            throw new Error('No POST data provided');
        }

        requestData = JSON.parse(e.postData.contents);
        const action = requestData.action;
        const logsSpreadsheetId = requestData.logsSpreadsheetId;
        const courseName = requestData.courseName;

        // --- 1. BYPASS AUTH FOR LOGIN ---
        // If the action is login, we skip token validation entirely.
        if (action === "loginWithNfc") {
            const result = loginWithNfc(requestData.uid, requestData.deviceId);
            return ContentService.createTextOutput(JSON.stringify(result))
                .setMimeType(ContentService.MimeType.TEXT);
        }

        // --- 2. VALIDATE TOKEN FOR EVERYTHING ELSE ---
        // For all other actions, we demand a valid token.
        // This line used to be at the top, causing the error. Now it's safe here.
        const userEmail = validateToken(requestData.access_token);

        // --- 3. STRICT ADMIN CHECKS ---
        const strictAdminActions = [
            "syncDatabase_Admin", "approveRegistration", "rejectRegistration",
            "addEntryToDatabase_Admin", "updateStudentInDatabase_Admin",
            "syncCourseLogs_Admin", "deleteLog_Admin", "deleteEntryFromDatabase_Admin",
            "deleteRegistration", "approveAbsenceRequest", "rejectAbsenceRequest",
            "deleteAbsenceRequest", "saveCourseSettings_Admin"
        ];

        if (strictAdminActions.includes(action)) {
            const adminAccess = checkAdminAccess(logsSpreadsheetId, courseName || '', userEmail);
            if (!adminAccess.hasAccess) {
                throw new Error('Authorization Error: You are not an admin for this course');
            }
        }

        let resultData;
        switch (action) {
            case "getGlobalSettingsData":
                resultData = getGlobalSettingsData(userEmail);
                break;
            case "registerDevice_Admin":
                resultData = registerDevice_Admin(requestData, userEmail);
                break;
            case "manageStaff_Admin":
                resultData = manageStaff_Admin(requestData);
                break;
            case "deleteDevice_Admin":
                resultData = deleteDevice_Admin(requestData);
                break;
            case "checkAdminStatus":
                resultData = checkUserAdminStatus(logsSpreadsheetId, userEmail);
                break;
            case "getBootData":
                resultData = getBootData(logsSpreadsheetId, userEmail);
                break;
            case "getDatabase":
                resultData = getDatabase();
                break;
            case "getCourseInfo":
                resultData = getCourseInfo(logsSpreadsheetId);
                break;
            case "getAvailableCourses":
                resultData = getAvailableCourses(logsSpreadsheetId, userEmail);
                break;
            case "getCourseLogs_Admin":
                resultData = getCourseLogs_Admin(courseName, logsSpreadsheetId, userEmail);
                break;
            case "getStudentLogs":
                resultData = getStudentLogs(courseName, logsSpreadsheetId, userEmail);
                break;
            case "getPendingRegistrations":
                const adminRegStatus = checkUserAdminStatus(logsSpreadsheetId, userEmail);
                if (!adminRegStatus.isAdmin) throw new Error('Authorization Error: Not an admin.');
                resultData = getPendingRegistrations(logsSpreadsheetId, courseName || '');
                break;
            case "getPendingAbsences":
                resultData = getPendingAbsences(logsSpreadsheetId, userEmail);
                break;
            case "getAbsenceHistory_Admin":
                resultData = getAbsenceHistory_Admin(logsSpreadsheetId, userEmail);
                break;
            case "getStudentAbsenceRequests":
                resultData = getStudentAbsenceRequests(logsSpreadsheetId, userEmail);
                break;
            case "submitRegistration":
                resultData = handleNewSubmission(requestData, userEmail);
                break;
            case "submitAbsenceRequest":
                resultData = handleSubmitAbsenceRequest(requestData, logsSpreadsheetId, userEmail);
                break;
            case "syncCourseLogs_Admin":
                resultData = syncCourseLogs_Admin(courseName || '', requestData.logs, requestData.tombstones || [], logsSpreadsheetId, userEmail);
                break;
            case "approveRegistration":
                resultData = approveRegistration(requestData, logsSpreadsheetId, courseName || '', userEmail);
                break;
            case "rejectRegistration":
                resultData = rejectRegistration(requestData, logsSpreadsheetId, courseName || '', userEmail);
                break;
            case "addEntryToDatabase_Admin":
                resultData = addEntryToDatabase_Admin(requestData, userEmail);
                break;
            case "syncDatabase_Admin":
                resultData = syncDatabase_Admin(requestData.databaseData, logsSpreadsheetId, courseName || '');
                break;
            case "updateStudentInDatabase_Admin":
                resultData = updateStudentInDatabase_Admin(requestData, userEmail);
                break;
            case 'deleteLog_Admin':
                resultData = deleteLog_Admin(requestData);
                break;
            case 'deleteEntryFromDatabase_Admin':
                resultData = deleteEntryFromDatabase_Admin(requestData, userEmail);
                break;
            case 'deleteRegistration':
                resultData = deleteRegistration(requestData, logsSpreadsheetId, courseName || '');
                break;
            case 'approveAbsenceRequest':
                resultData = approveAbsenceRequest(requestData, logsSpreadsheetId, userEmail);
                break;
            case 'rejectAbsenceRequest':
                resultData = rejectAbsenceRequest(requestData, logsSpreadsheetId, userEmail);
                break;
            case 'deleteAbsenceRequest':
                resultData = deleteAbsenceRequest(requestData, logsSpreadsheetId, userEmail);
                break;
            case "saveCourseSettings_Admin":
                resultData = saveCourseSettings_Admin(requestData, logsSpreadsheetId, userEmail);
                break;
            default:
                throw new Error(`Invalid POST action requested: ${action}`);
        }

        if (resultData && resultData.result === 'error') throw new Error(resultData.message);

        return ContentService.createTextOutput(JSON.stringify(resultData))
            .setMimeType(ContentService.MimeType.TEXT);

    } catch (error) {
        Logger.log(`doPost Error: ${error.message}`);
        return ContentService.createTextOutput(JSON.stringify({ result: "error", message: error.message }))
            .setMimeType(ContentService.MimeType.TEXT);
    }
}

/**
 * Validates Token and throws specific error for expiration
 */
function validateToken(token) {
    if (!token || token === 'undefined' || token === 'null') {
        throw new Error('Authorization failed: No token provided.');
    }
    // Handle KIOSK tokens (if you use them)
    if (typeof KIOSK_TOKEN_PREFIX !== 'undefined' && token.startsWith(KIOSK_TOKEN_PREFIX)) {
        const cache = CacheService.getScriptCache();
        const cachedEmail = cache.get(token);
        if (cachedEmail) {
            return cachedEmail;
        } else {
            throw new Error('KIOSK_SESSION_EXPIRED');
        }
    }
    // 1. Encode the token so special characters don't break the URL
    const tokenInfoUrl = 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token);

    try {
        const response = UrlFetchApp.fetch(tokenInfoUrl);
        const data = JSON.parse(response.getContentText());

        // 2. Throw the actual error from Google if present
        if (data.error) throw new Error(data.error_description);

        return data.email;
    } catch (e) {
        // 3. Return a detailed error message so we can see WHY it failed in the logs
        Logger.log("Token validation failed: " + e.message);
        throw new Error('Authorization failed: Invalid token. Debug Info: ' + e.message);
    }
}

/**
 * Check admin status
 */
function checkUserAdminStatus(logsSpreadsheetId, userEmail) {
    if (!userEmail) return { isAdmin: false, isGlobalAdmin: false, courses: [] };

    const emailLower = userEmail.trim().toLowerCase();

    // 1. Check Hardcoded Safety Net
    let isGlobal = FALLBACK_GLOBAL_ADMINS.some(e => e.toLowerCase() === emailLower);

    // 2. Check "STAFF_KEYS" for 'Global' Role
    if (!isGlobal) {
        try {
            const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
            const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
            if (staffSheet) {
                const data = staffSheet.getDataRange().getValues();
                // Skip header. Column C is Email (index 2), Column D is Role (index 3)
                for (let i = 1; i < data.length; i++) {
                    const rowEmail = String(data[i][2]).trim().toLowerCase();
                    const rowRole = String(data[i][3]).trim().toLowerCase();

                    if (rowEmail === emailLower && rowRole === 'global') {
                        isGlobal = true;
                        break;
                    }
                }
            }
        } catch (e) {
            Logger.log("Error checking global role from sheet: " + e);
        }
    }

    // 3. Check Course-Specific Admin Access
    let adminCourses = [];
    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const infoSheet = ss.getSheetByName('COURSE_INFO');
        if (infoSheet) {
            const data = infoSheet.getDataRange().getValues();
            const headers = data[0].map(h => String(h).trim().toLowerCase());

            const adminColumnIndex = headers.indexOf('admin_emails');

            if (adminColumnIndex > -1) {
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    const courseName = row[0];
                    if (!courseName) continue;

                    if (row.length > adminColumnIndex && row[adminColumnIndex]) {
                        const adminCell = String(row[adminColumnIndex]);
                        const emails = adminCell.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
                        if (emails.includes(emailLower)) {
                            adminCourses.push(courseName);
                        }
                    }
                }
            } else {
                Logger.log("WARNING: 'admin_emails' column not found in COURSE_INFO");
            }
        }
    } catch (e) {
        Logger.log('Error checking course admin status: ' + e);
    }

    return {
        isAdmin: isGlobal || adminCourses.length > 0,
        isGlobalAdmin: isGlobal,
        courses: adminCourses
    };
}

/**
 * Fetches all critical boot data in a single call.
 */
function getBootData(logsSpreadsheetId, userEmail) {
    try {
        const adminStatus = checkUserAdminStatus(logsSpreadsheetId, userEmail);
        const courses = getAvailableCourses(logsSpreadsheetId, userEmail);
        const database = getDatabase(); // <-- ADD THIS
        const courseInfo = getCourseInfo(logsSpreadsheetId); // <-- ADD THIS

        return {
            result: 'success',
            adminStatus: adminStatus,
            courses: courses,
            database: database,
            courseInfo: courseInfo
        };

    } catch (e) {
        Logger.log(`Error in getBootData: ${e.message}`);
        return { result: 'error', message: e.message };
    }
}

/**
 * Gets a list of course-specific admin emails for a given course.
 * @param {string} logsSpreadsheetId The ID of the logs spreadsheet.
 * @param {string} courseName The name of the course.
 * @returns {string[]} An array of admin emails.
 */
function getAdminEmailsForCourse(logsSpreadsheetId, courseName) {
    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const infoSheet = ss.getSheetByName('COURSE_INFO');

        if (infoSheet) {
            const data = infoSheet.getDataRange().getValues();
            const headers = data[0].map(h => String(h).trim().toLowerCase());
            const adminColumnIndex = headers.indexOf('admin_emails');

            if (adminColumnIndex === -1) {
                Logger.log("getAdminEmailsForCourse: 'admin_emails' column not found in COURSE_INFO");
                return [];
            }

            const courseRow = data.find((row, i) =>
                i > 0 && row[0] && String(row[0]).trim().toLowerCase() === courseName.trim().toLowerCase()
            );

            if (courseRow && courseRow[adminColumnIndex]) {
                return String(courseRow[adminColumnIndex])
                    .split(',')
                    .map(email => email.trim())
                    .filter(Boolean);
            }
        }
    } catch (e) {
        Logger.log(`Error in getAdminEmailsForCourse: ${e}`);
    }
    return [];
}

function formatAdminEmailsForCC(emails) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
        if (!staffSheet) return emails;

        const staffData = staffSheet.getDataRange().getValues();
        const nameMap = {};
        for (let i = 1; i < staffData.length; i++) {
            const name = String(staffData[i][0]).trim();
            const email = String(staffData[i][2]).trim().toLowerCase();
            if (email) nameMap[email] = name;
        }

        return emails.map(email => {
            const name = nameMap[email.toLowerCase()];
            return name ? `"${name}" <${email}>` : email;
        });
    } catch (e) {
        Logger.log('Could not format admin emails for CC: ' + e);
        return emails;
    }
}

/**
 * Update or Create a Course in COURSE_INFO
 * Handles renaming of the actual Worksheet if the course name changes.
 */
function saveCourseSettings_Admin(data, logsSpreadsheetId, userEmail) {
    const access = checkAdminAccess(logsSpreadsheetId, data.originalName || '', userEmail);

    if (!access.hasAccess) {
        return { result: 'error', message: 'Authorization failed.' };
    }

    const isGlobal = access.level === 'global';

    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const infoSheet = ss.getSheetByName('COURSE_INFO');
        if (!infoSheet) throw new Error('COURSE_INFO sheet not found');

        const values = infoSheet.getDataRange().getValues();
        const headers = values[0].map(h => String(h).trim().toLowerCase());

        // Map headers
        const colIndices = {};
        Object.keys(COURSE_COLUMN_MAP).forEach(sheetHeader => {
            colIndices[sheetHeader] = headers.indexOf(sheetHeader);
        });

        // 1. Find the Row Index first
        let rowIndex = -1;
        if (data.originalName) {
            for (let i = 1; i < values.length; i++) {
                if (values[i][colIndices["course"]] === data.originalName) {
                    rowIndex = i + 1;
                    break;
                }
            }
        }

        // --- 2. PRIORITY: Handle Deletion First ---
        if (data.isDelete) {
            if (!isGlobal) return { result: 'error', message: 'Only Global Admins can delete courses.' };

            if (rowIndex > -1) {
                // A. Delete from Index
                infoSheet.deleteRow(rowIndex);

                // B. Delete the Worksheet
                const dataSheet = ss.getSheetByName(data.originalName);
                if (dataSheet) {
                    try { ss.deleteSheet(dataSheet); }
                    catch (e) { Logger.log("Sheet delete warning: " + e.message); }
                }
                return { result: 'success', message: 'Course and data deleted.' };
            }
            return { result: 'error', message: 'Course not found.' };
        }

        // --- 3. RENAME LOGIC (Only if NOT deleting) ---
        if (data.originalName && data.courseName && data.originalName !== data.courseName) {

            // A. Validation
            if (data.courseName.length > 100) return { result: 'error', message: 'Course name too long.' };
            if (/[:\\\/?*\[\]]/.test(data.courseName)) return { result: 'error', message: 'Invalid characters in name.' };

            // B. Check for Duplicates
            const existingSheet = ss.getSheetByName(data.courseName);
            if (existingSheet) {
                return { result: 'error', message: `A worksheet named "${data.courseName}" already exists.` };
            }

            // C. Rename Worksheet
            const oldSheet = ss.getSheetByName(data.originalName);
            if (oldSheet) {
                oldSheet.setName(data.courseName);
            }
        }

        // --- 4. Prepare Row Data ---
        let rowData = [];
        if (rowIndex > -1) {
            rowData = values[rowIndex - 1];
        } else {
            if (!isGlobal) return { result: 'error', message: 'Only Global Admins can create new courses.' };
            rowData = new Array(headers.length).fill('');
        }

        // --- 5. Apply Updates ---
        Object.entries(COURSE_COLUMN_MAP).forEach(([sheetHeader, frontendKey]) => {
            const colIndex = colIndices[sheetHeader];
            if (colIndex > -1) {
                let newValue = data[frontendKey];

                // Security Check for Non-Globals
                if (!isGlobal) {
                    const allowedFields = ['defaultHours', 'availableSections'];
                    if (!allowedFields.includes(frontendKey)) return;
                }

                if (newValue !== undefined) {
                    rowData[colIndex] = newValue;
                }
            }
        });

        // --- 6. Write Data ---
        // If we found a row (rowIndex > 0), we update it.
        // If rowIndex is -1 (New Course), we APPEND.
        if (rowIndex > 0) {
            infoSheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
        } else {
            infoSheet.appendRow(rowData);
        }

        return { result: 'success', message: 'Course settings saved.' };

    } catch (e) {
        return { result: 'error', message: e.message };
    }
}

/**
 * Decodes a Base64 string and saves it as a file in Google Drive,
 * sharing it with the specified editors.
 * @param {string} base64Data The Base64-encoded file data.
 * @param {string} fileName The desired name for the file.
 * @param {string} fileType The MIME type of the file (e.g., "application/pdf").
 * @param {string[]} adminEmails An array of emails to share the file with.
 * @returns {string} The URL of the newly created file.
 */
function saveFileToDrive(base64Data, fileName, fileType, adminEmails) {
    try {
        // 1. Decode the Base64 string
        const dataParts = base64Data.split(',');
        const base64Text = dataParts[1];
        const decodedBytes = Utilities.base64Decode(base64Text);

        // 2. Create a "Blob" (file object)
        const blob = Utilities.newBlob(decodedBytes, fileType, fileName);

        // 3. Get the folder and create the file
        const folder = DriveApp.getFolderById(ATTACHMENTS_FOLDER_ID);
        const file = folder.createFile(blob);

        // 4. --- Share the file with admins (silent) ---
        if (adminEmails && adminEmails.length > 0) {
            const uniqueEmails = [...new Set(adminEmails)];
            const fileId = file.getId();
            uniqueEmails.forEach(email => {
                try {
                    Drive.Permissions.create(
                        { role: 'writer', type: 'user', emailAddress: email },
                        fileId,
                        { sendNotificationEmail: false }
                    );
                } catch (e) {
                    Logger.log(`Could not share attachment with ${email}: ${e}`);
                }
            });
        }

        // 5. --- Return URL using the File ID ---
        const fileId = file.getId();
        if (!fileId) {
            Logger.log('Error getting file ID immediately after creation.');
            throw new Error('Could not get File ID after saving to Drive.');
        }

        // Return the robust URL
        return `https://drive.google.com/file/d/${fileId}/view`;

    } catch (e) {
        Logger.log('Error saving file to Drive: ' + e.message);
        throw new Error('Could not save attachment to Google Drive. ' + e.message);
    }
}

function getCourseInfo(logsSpreadsheetId) {
    const courseInfoMap = {};
    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const infoSheet = ss.getSheetByName('COURSE_INFO');

        if (!infoSheet) {
            Logger.log("No COURSE_INFO sheet found");
            return courseInfoMap;
        }

        const data = infoSheet.getDataRange().getValues();
        if (data.length < 2) return courseInfoMap;

        const headers = data[0].map(h => String(h).trim().toLowerCase());

        // 1. Map headers to indices
        const colIndices = {};
        Object.keys(COURSE_COLUMN_MAP).forEach(sheetHeader => {
            colIndices[sheetHeader] = headers.indexOf(sheetHeader);
        });

        if (colIndices["course"] === -1) return courseInfoMap;

        // 2. Process Rows
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const courseName = row[colIndices["course"]];
            if (!courseName) continue;

            const courseData = {};

            // 3. Dynamically build the object using the Map
            Object.entries(COURSE_COLUMN_MAP).forEach(([sheetHeader, frontendKey]) => {
                if (sheetHeader === "course") return; // Skip key, already have it

                const index = colIndices[sheetHeader];
                let value = index > -1 ? row[index] : "";

                // Specific cleanup for text fields to prevent "undefined" or space issues
                if (sheetHeader === "default_category" || sheetHeader === "default_section") {
                    value = value ? String(value).trim() : "";
                }
                // Ensure numbers are strings or numbers, not dates
                if (sheetHeader === "holiday_weeks" || sheetHeader === "default_hours") {
                    value = value.toString();
                }

                courseData[frontendKey] = value;
            });

            // Set default if category is missing
            if (!courseData.defaultCategory) courseData.defaultCategory = "theory";

            courseInfoMap[courseName] = courseData;
        }

        return courseInfoMap;

    } catch (e) {
        Logger.log("Error in getCourseInfo: " + e.toString());
        return courseInfoMap;
    }
}

function getDatabase() {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const sheet = ss.getSheetByName(DATABASE_SHEET_NAME);

        if (!sheet) {
            Logger.log('Database sheet not found: ' + DATABASE_SHEET_NAME);
            return {};
        }

        const data = sheet.getDataRange().getValues();
        const database = {};

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const index = row[0];
            const name = row[1] ? String(row[1]).trim() : '';
            const uidsString = row[2] || '';
            // Force string and trim whitespace so " email " becomes "email"
            const email = row[3] ? String(row[3]).trim() : '';

            const uids = uidsString.toString().split(',').map(uid => uid.trim()).filter(uid => uid !== '');

            if (index && uids.length > 0) {
                database[index] = { name, email, uids };
            }
        }

        return database;
    } catch (e) {
        Logger.log('Error getting database: ' + e.message);
        throw new Error('Failed to fetch database: ' + e.message);
    }
}

function getAvailableCourses(logsSpreadsheetId, userEmail) {
    try {
        const adminStatus = checkUserAdminStatus(logsSpreadsheetId, userEmail); // Gets adminStatus
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const infoSheet = ss.getSheetByName('COURSE_INFO');

        if (!infoSheet) {
            Logger.log('COURSE_INFO sheet not found');
            return {};
        }

        const data = infoSheet.getDataRange().getValues();
        const result = {};

        // If the user is listed in specific courses (adminCourses), show ONLY those.
        // This applies to both global admins and course admins.
        if (adminStatus.courses && adminStatus.courses.length > 0) {
            adminStatus.courses.forEach(courseName => {
                // Check if courseName actually exists in the sheet to prevent errors
                const courseExists = data.slice(1).some(row => row[0] === courseName);
                if (courseExists) {
                    result[courseName] = logsSpreadsheetId;
                }
            });
            Logger.log(`Admin has access to ${Object.keys(result).length} courses from their explicit list.`);
            return result;
        }

        // If they are a global admin but not listed in ANY specific courses, show all courses.
        if (adminStatus.isGlobalAdmin) {
            Logger.log('Global admin is not listed in any specific courses; showing all courses as fallback.');
            for (let i = 1; i < data.length; i++) {
                const courseName = data[i][0];
                if (courseName) {
                    result[courseName] = logsSpreadsheetId;
                }
            }
            return result;
        }

        // If they are an admin but have 0 courses listed (and not global), they will see 0 courses.
        if (adminStatus.isAdmin) {
            Logger.log('Course admin is not listed in any courses.');
            return result; // Return empty object
        }


        const database = getDatabase();
        const studentUids = [];

        Object.keys(database).forEach(index => {
            const record = database[index];
            if (record.email && record.email.toLowerCase() === userEmail.toLowerCase()) {
                studentUids.push(...record.uids);
            }
        });

        if (studentUids.length === 0) {
            Logger.log('Student has no UIDs in database');
            return {};
        }

        for (let i = 1; i < data.length; i++) {
            const courseName = data[i][0];
            if (!courseName) continue;

            try {
                const courseSheet = ss.getSheetByName(courseName);
                if (!courseSheet) continue;

                const logs = courseSheet.getDataRange().getValues();
                const hasStudentLogs = logs.slice(1).some(row => {
                    const logUid = row[0];
                    return studentUids.includes(logUid);
                });

                if (hasStudentLogs) {
                    result[courseName] = logsSpreadsheetId;
                }
            } catch (e) {
                Logger.log(`Error checking course ${courseName}: ${e.message}`);
            }
        }

        Logger.log(`Student has access to ${Object.keys(result).length} courses`);
        return result;

    } catch (e) {
        Logger.log('Error getting available courses: ' + e.message);
        throw new Error('Failed to fetch courses: ' + e.message);
    }
}

function getStudentLogs(courseName, logsSpreadsheetId, userEmail) {
    try {
        const database = getDatabase();
        const studentUids = [];

        Object.keys(database).forEach(index => {
            const record = database[index];
            if (record.email && record.email.toLowerCase() === userEmail.toLowerCase()) {
                studentUids.push(...record.uids);
            }
        });

        if (studentUids.length === 0) {
            return [];
        }

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const courseSheet = ss.getSheetByName(courseName);

        if (!courseSheet) {
            Logger.log(`Course sheet ${courseName} not found in logs spreadsheet`);
            return [];
        }

        const logsData = courseSheet.getDataRange().getValues();
        const logs = [];

        for (let i = 1; i < logsData.length; i++) {
            const row = logsData[i];
            const uid = row[0];

            if (studentUids.includes(uid)) {
                logs.push({
                    uid: uid,
                    timestamp: new Date(row[1]).getTime(),
                    id: row[2] || '',
                    manual: row[3] === true || row[3] === 'true' || row[3] === 'TRUE',
                    editedBy: row[4] || '',
                    session: row[7] || ''
                });
            }
        }

        return logs;

    } catch (e) {
        Logger.log(`Error getting student logs: ${e.message}`);
        throw new Error('Failed to fetch logs: ' + e.message);
    }
}

function handleSubmitAbsenceRequest(data, logsSpreadsheetId, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const sheet = ss.getSheetByName("ABSENCES");
        if (!sheet) {
            throw new Error('"ABSENCES" sheet not found in Attendance Logs.');
        }

        const timestamp = new Date();
        const requestID = `${timestamp.getTime()}_${userEmail}`;
        let attachmentURL = "";

        if (data.fileData && data.fileName && data.fileType) {
            const courseAdmins = getAdminEmailsForCourse(logsSpreadsheetId, data.course);
            const globalAdmins = getAllGlobalAdminEmails();
            const allAdmins = [...new Set([...globalAdmins, ...courseAdmins])];
            const uniqueFileName = `${timestamp.getTime()}_${data.fileName}`;
            attachmentURL = saveFileToDrive(data.fileData, uniqueFileName, data.fileType, allAdmins);
        }

        const hoursAsText = "'" + data.hours;

        sheet.appendRow([
            requestID,         // A
            timestamp,         // B
            "Pending",         // C
            data.name,         // D
            data.email,        // E
            data.course,       // F
            data.session || "",// G (Session)
            data.absenceDate,  // H
            hoursAsText,       // I
            data.reasonType,   // J
            data.description,  // K
            "",                // L (AdminNotes - empty on submission)
            attachmentURL || "", // M (AttachmentURL)
        ]);

        // --- Send Confirmation Email ---
        try {
            const courseAdmins = getAdminEmailsForCourse(logsSpreadsheetId, data.course);
            const globalAdmins = getAllGlobalAdminEmails();
            // Use first available admin for signature
            const adminEmailForSig = (courseAdmins && courseAdmins.length > 0) ? courseAdmins[0] : (globalAdmins[0] || "admin@stando.app");

            // Get Student Name from DB if available (already computed as 'studentUid')
            let studentName = "Student";
            if (studentUid && database[studentUid]) {
                studentName = database[studentUid].name;
            }

            sendAbsenceRequestReceivedEmail(studentName, userEmail, data.course, data.absenceDate, data.reasonType, adminEmailForSig);
        } catch (emailErr) {
            Logger.log("Error sending confirmation email: " + emailErr.message);
        }

        return { result: 'success', message: 'Absence request submitted successfully' };

    } catch (e) {
        Logger.log('Error handling absence submission: ' + e.message);
        return { result: 'error', message: 'Failed to submit: ' + e.message };
    }
}

function approveAbsenceRequest(data, logsSpreadsheetId, adminEmail) {
    try {
        const {
            requestID,
            studentName,
            studentEmail,
            originalHours,
            approvedHours,
            customMessage
        } = data;

        if (!approvedHours || approvedHours.length === 0) {
            throw new Error("No hours were selected for approval.");
        }

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const absencesSheet = ss.getSheetByName("ABSENCES");
        if (!absencesSheet) throw new Error('"ABSENCES" sheet not found.');

        const reqData = absencesSheet.getDataRange().getValues();
        const headers = reqData[0].map(h => String(h).toLowerCase());
        const reqIdIdx = headers.indexOf("requestid");

        // Find Session Column (or default to index 12 if missing header, as we just appended it)
        let sessionIdx = headers.indexOf("session");
        if (sessionIdx === -1) sessionIdx = 6; // Column G is index 6

        let requestRow = -1;
        let requestInfo = {};

        for (let i = 1; i < reqData.length; i++) {
            if (String(reqData[i][reqIdIdx]) === String(requestID)) {
                requestRow = i + 1;
                requestInfo.Course = reqData[i][5]; // Column F

                requestInfo.Session = (reqData[i][sessionIdx]) ? String(reqData[i][sessionIdx]) : "Default";

                let dateFromSheet = reqData[i][7];
                if (dateFromSheet instanceof Date) {
                    requestInfo.AbsenceDate = Utilities.formatDate(dateFromSheet, Session.getScriptTimeZone(), "yyyy-MM-dd");
                } else {
                    requestInfo.AbsenceDate = String(dateFromSheet);
                }
                break;
            }
        }

        if (requestRow === -1) throw new Error(`Request ID ${requestID} not found.`);

        // Find Student UID
        const database = getDatabase();
        let studentUid = null;
        for (const key in database) {
            if (database[key].email.toLowerCase() === studentEmail.toLowerCase()) {
                studentUid = database[key].uids[0];
                break;
            }
        }
        if (!studentUid) throw new Error(`Student ${studentEmail} not found in database.`);

        // Add Logs
        const courseSheet = ss.getSheetByName(requestInfo.Course);
        if (!courseSheet) throw new Error(`Course sheet "${requestInfo.Course}" not found.`);

        const [year, month, day] = requestInfo.AbsenceDate.split('-').map(Number);
        const hoursToApprove = approvedHours.split(',').map(h => h.trim());
        const newLogRows = [];
        const newLogObjects = [];

        for (const hourStr of hoursToApprove) {
            // Handle time ranges (e.g. "9:40-10:30") by extracting the start time
            const timeMatch = hourStr.match(/(\d{1,2}):(\d{2})/);
            if (!timeMatch) throw new Error(`Invalid time format: ${hourStr}`);
            const hour = Number(timeMatch[1]);
            const minute = Number(timeMatch[2]);
            const logTimestamp = new Date(year, month - 1, day, hour, minute);
            const logTimestampMs = logTimestamp.getTime();
            const logId = `${logTimestampMs}_${studentUid}_manual`;

            const newLogObject = {
                uid: studentUid,
                timestamp: logTimestampMs,
                id: logId,
                manual: true,
                version: 1,
                updatedAt: new Date().getTime(),
                updatedBy: adminEmail,
                course: requestInfo.Course,
                session: requestInfo.Session
            };

            newLogRows.push([
                newLogObject.uid,
                logTimestamp.toISOString(),
                newLogObject.id,
                newLogObject.manual,
                newLogObject.version,
                new Date(newLogObject.updatedAt).toISOString(),
                newLogObject.updatedBy,
                newLogObject.session
            ]);

            newLogObjects.push(newLogObject);
        }

        if (newLogRows.length > 0) {
            courseSheet.getRange(courseSheet.getLastRow() + 1, 1, newLogRows.length, 8).setValues(newLogRows);
        }

        // Update Status
        const statusIdx = 2;      // Column C (Unchanged)
        const hoursIdx = 8;       // Column I (Was H, shifted +1)
        const adminNotesIdx = 11; // Column L (Was K, shifted +1)

        const approvedMsg = `Approved ${hoursToApprove.length}/${originalHours.split(',').length} hours by ${adminEmail}`;
        absencesSheet.getRange(requestRow, statusIdx + 1).setValue("Approved");
        absencesSheet.getRange(requestRow, adminNotesIdx + 1).setValue(approvedMsg);
        absencesSheet.getRange(requestRow, hoursIdx + 1).setValue(approvedHours);

        sendAbsenceApprovalEmail(studentName, studentEmail, customMessage, approvedHours, originalHours, adminEmail, requestInfo.Course, logsSpreadsheetId);

        return {
            result: "success",
            message: `Approved ${newLogObjects.length} logs for ${studentName}.`,
            newLogs: newLogObjects
        };

    } catch (e) {
        Logger.log('Error approving absence: ' + e.message);
        return { result: "error", message: e.message };
    }
}

function handleNewSubmission(data, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const regSheet = ss.getSheetByName(REGISTRATION_SHEET_NAME);

        if (!regSheet) {
            throw new Error('Registrations sheet not found');
        }

        let sentByText = '';
        if (data.sentBy) {
            sentByText = data.sentBy.name || data.sentBy.email || userEmail;
        } else {
            sentByText = userEmail;
        }

        const timestamp = new Date();

        regSheet.appendRow([
            data.name || '',
            data.uid || '',
            data.email || '',
            timestamp,
            sentByText
        ]);

        return {
            result: 'success',
            message: 'Registration submitted successfully'
        };

    } catch (e) {
        Logger.log('Error handling submission: ' + e.message);
        return {
            result: 'error',
            message: 'Failed to submit registration: ' + e.message
        };
    }
}

/**
 * Fetches ALL absence requests (Pending, Approved, Rejected).
 * Filtered by the admin's course access.
 */
function getAbsenceHistory_Admin(logsSpreadsheetId, userEmail) {
    try {
        const adminStatus = checkUserAdminStatus(logsSpreadsheetId, userEmail);
        if (!adminStatus.isAdmin) throw new Error('Permission denied');

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const sheet = ss.getSheetByName("ABSENCES");
        if (!sheet) return [];

        const data = sheet.getDataRange().getValues();
        if (data.length < 2) return [];

        const headers = data[0].map(h => h.toString().trim().toLowerCase());

        // Indices
        const reqIdIdx = headers.indexOf("requestid");
        const statusIdx = headers.indexOf("status");
        const courseIdx = headers.indexOf("course");
        const nameIdx = headers.indexOf("studentname");
        const emailIdx = headers.indexOf("studentemail");
        const dateIdx = headers.indexOf("absencedate");
        const hoursIdx = headers.indexOf("hours");
        const reasonIdx = headers.indexOf("reasontype");
        const descIdx = headers.indexOf("description");
        const notesIdx = headers.indexOf("adminnotes");

        let sessionIdx = headers.indexOf("session");
        if (sessionIdx === -1) sessionIdx = 6;

        let urlIdx = headers.indexOf("attachmenturl");
        if (urlIdx === -1) urlIdx = 12; // Column M fallback (matches appendRow order in handleSubmitAbsenceRequest)

        let allowedCoursesLower = [];
        if (!adminStatus.isGlobalAdmin) {
            if (!adminStatus.courses || adminStatus.courses.length === 0) return [];
            allowedCoursesLower = adminStatus.courses.map(c => String(c).trim().toLowerCase());
        }

        const history = [];

        for (let i = data.length - 1; i >= 1; i--) {
            const row = data[i];
            const courseRaw = row[courseIdx] ? String(row[courseIdx]).trim() : '';
            const courseLower = courseRaw.toLowerCase();

            if (!adminStatus.isGlobalAdmin) {
                if (!courseLower || !allowedCoursesLower.includes(courseLower)) continue;
            }

            let absenceDate = row[dateIdx];
            if (absenceDate instanceof Date) {
                absenceDate = Utilities.formatDate(absenceDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
            }

            // --- Handle Hours Date Object (1899 issue) ---
            let hoursValue = row[hoursIdx];
            if (hoursValue instanceof Date) {
                hoursValue = Utilities.formatDate(hoursValue, Session.getScriptTimeZone(), "HH:mm");
            } else {
                hoursValue = String(hoursValue);
            }

            history.push({
                status: row[statusIdx],
                requestID: row[reqIdIdx],
                studentName: row[nameIdx],
                studentEmail: row[emailIdx],
                course: courseRaw,
                session: row[sessionIdx] || "",
                absenceDate: absenceDate,
                hours: hoursValue, // Now safely formatted
                reasonType: row[reasonIdx],
                description: row[descIdx],
                attachmentUrl: (urlIdx > -1) ? row[urlIdx] : "",
                adminNotes: (notesIdx > -1) ? row[notesIdx] : ""
            });
        }

        return history;

    } catch (e) {
        Logger.log('Error getting history: ' + e.message);
        return { result: 'error', message: e.message };
    }
}

/**
 * Fetches pending absence requests, filtered by the courses the admin manages.
 */
function getPendingAbsences(logsSpreadsheetId, userEmail) {
    try {
        const adminStatus = checkUserAdminStatus(logsSpreadsheetId, userEmail);

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const sheet = ss.getSheetByName("ABSENCES");
        if (!sheet) throw new Error('"ABSENCES" sheet not found.');

        const data = sheet.getDataRange().getValues();
        const headers = data[0].map(h => h.toString().trim().toLowerCase());

        // Standard Indices
        const reqIdIdx = headers.indexOf("requestid");
        const nameIdx = headers.indexOf("studentname");
        const emailIdx = headers.indexOf("studentemail");
        const courseIdx = headers.indexOf("course");
        const dateIdx = headers.indexOf("absencedate");
        const hoursIdx = headers.indexOf("hours");
        const reasonIdx = headers.indexOf("reasontype");
        const descIdx = headers.indexOf("description");
        const statusIdx = headers.indexOf("status");

        let sessionIdx = headers.indexOf("session");
        if (sessionIdx === -1) sessionIdx = 6;

        let urlIdx = headers.indexOf("attachmenturl");
        if (urlIdx === -1) urlIdx = 12; // Column M fallback (matches appendRow order in handleSubmitAbsenceRequest)

        let manageableCourses = [];
        if (!adminStatus.isGlobalAdmin) {
            manageableCourses = adminStatus.courses;
        }

        const pendingRequests = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const status = row[statusIdx] ? String(row[statusIdx]).trim() : '';
            const course = row[courseIdx] ? String(row[courseIdx]).trim() : '';

            if (status !== "Pending") continue;
            if (!adminStatus.isGlobalAdmin && !manageableCourses.includes(course)) continue;

            let absenceDate = row[dateIdx];
            if (absenceDate instanceof Date) {
                absenceDate = Utilities.formatDate(absenceDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
            }

            let hoursValue = row[hoursIdx];
            if (hoursValue instanceof Date) {
                hoursValue = Utilities.formatDate(hoursValue, Session.getScriptTimeZone(), "HH:mm");
            } else {
                hoursValue = String(hoursValue);
            }

            pendingRequests.push({
                rowNumber: i + 1,
                requestID: row[reqIdIdx],
                name: row[nameIdx],
                email: row[emailIdx],
                course: course,
                session: row[sessionIdx] || "", // <--- READ SESSION
                absenceDate: absenceDate,
                hours: hoursValue,
                reasonType: row[reasonIdx],
                description: row[descIdx],
                attachmentURL: (urlIdx > -1) ? row[urlIdx] : ""
            });
        }

        return pendingRequests;

    } catch (e) {
        Logger.log('Error getting pending absences: ' + e.message);
        throw new Error('Failed to fetch pending absences: ' + e.message);
    }
}

/**
 * Fetches all absence requests (pending, approved, rejected) for the logged-in student.
 */
function getStudentAbsenceRequests(logsSpreadsheetId, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const sheet = ss.getSheetByName("ABSENCES");
        if (!sheet) {
            // No sheet, just return an empty array. Not a critical error.
            return [];
        }

        const data = sheet.getDataRange().getValues();
        const headers = data[0];

        // Find column indices
        const emailIdx = headers.indexOf("StudentEmail");
        const statusIdx = headers.indexOf("Status");
        const courseIdx = headers.indexOf("Course");
        const dateIdx = headers.indexOf("AbsenceDate");
        const hoursIdx = headers.indexOf("Hours");
        const reasonIdx = headers.indexOf("ReasonType");
        const notesIdx = headers.indexOf("AdminNotes");

        if (emailIdx === -1 || statusIdx === -1) {
            // Sheet is not set up correctly, but don't error out, just return empty.
            Logger.log("Could not find 'StudentEmail' or 'Status' in ABSENCES sheet.");
            return [];
        }

        const myRequests = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const email = row[emailIdx] ? String(row[emailIdx]).trim() : '';

            if (email.toLowerCase() === userEmail.toLowerCase()) {
                // This request belongs to the student
                let absenceDate = row[dateIdx];
                if (absenceDate instanceof Date) {
                    absenceDate = absenceDate.toISOString().split('T')[0];
                }

                myRequests.push({
                    status: row[statusIdx],
                    course: row[courseIdx],
                    absenceDate: absenceDate,
                    hours: row[hoursIdx],
                    reason: row[reasonIdx],
                    adminNotes: row[notesIdx] || ''
                });
            }
        }

        // Return newest first
        return myRequests.reverse();

    } catch (e) {
        Logger.log('Error in getStudentAbsenceRequests: ' + e.message);
        // Don't throw an error, just return empty. This is not a critical function.
        return [];
    }
}

/**
 * Approves an absence request:
 * 1. Finds the student's UID from the database.
 * 2. Adds new MANUAL logs to the correct course sheet FOR APPROVED HOURS.
 * 3. Updates the status in the 'ABSENCES' sheet.
 * 4. Sends a custom approval email.
 * 5. Returns the newly created logs to the frontend.
 */
function approveAbsenceRequest(data, logsSpreadsheetId, adminEmail) {
    try {
        const {
            requestID,
            studentName,
            studentEmail,
            originalHours,
            approvedHours,
            customMessage
        } = data;

        if (!approvedHours || approvedHours.length === 0) {
            throw new Error("No hours were selected for approval.");
        }

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const absencesSheet = ss.getSheetByName("ABSENCES");
        if (!absencesSheet) throw new Error('"ABSENCES" sheet not found.');

        const reqData = absencesSheet.getDataRange().getValues();
        const headers = reqData[0].map(h => String(h).trim().toLowerCase());

        // --- 1. DEFINE INDICES DYNAMICALLY (Based on your snippet) ---
        const reqIdIdx = headers.indexOf("requestid");
        const statusIdx = headers.indexOf("status");
        const courseIdx = headers.indexOf("course");
        // const nameIdx = headers.indexOf("studentname"); // Not strictly needed for logic
        // const emailIdx = headers.indexOf("studentemail"); // Not strictly needed for logic
        const dateIdx = headers.indexOf("absencedate");
        const hoursIdx = headers.indexOf("hours");
        // const reasonIdx = headers.indexOf("reasontype"); // Not strictly needed
        // const descIdx = headers.indexOf("description"); // Not strictly needed
        const notesIdx = headers.indexOf("adminnotes");

        // Session Mapping (User requested G/Index 6)
        let sessionIdx = headers.indexOf("session");
        if (sessionIdx === -1) sessionIdx = 6;

        // Sanity Check: Ensure critical columns were found
        if (reqIdIdx === -1 || statusIdx === -1 || dateIdx === -1) {
            throw new Error("Critical columns (RequestID, Status, AbsenceDate) not found in ABSENCES sheet.");
        }

        let requestRow = -1;
        let requestInfo = {};

        // --- 2. FIND ROW ---
        for (let i = 1; i < reqData.length; i++) {
            if (String(reqData[i][reqIdIdx]) === String(requestID)) {
                requestRow = i + 1; // 1-based row index for Sheets API

                requestInfo.Course = reqData[i][courseIdx];
                requestInfo.Session = (reqData[i][sessionIdx]) ? String(reqData[i][sessionIdx]) : "Default";

                let dateFromSheet = reqData[i][dateIdx];
                if (dateFromSheet instanceof Date) {
                    requestInfo.AbsenceDate = Utilities.formatDate(dateFromSheet, Session.getScriptTimeZone(), "yyyy-MM-dd");
                } else {
                    requestInfo.AbsenceDate = String(dateFromSheet);
                }
                break;
            }
        }

        if (requestRow === -1) throw new Error(`Request ID ${requestID} not found.`);

        // --- 3. DATABASE LOOKUP (Student UID) ---
        const database = getDatabase();
        let studentUid = null;
        for (const key in database) {
            if (database[key].email.toLowerCase() === studentEmail.toLowerCase()) {
                studentUid = database[key].uids[0];
                break;
            }
        }
        if (!studentUid) throw new Error(`Student ${studentEmail} not found in database.`);

        // --- 4. CREATE LOGS ---
        const courseSheet = ss.getSheetByName(requestInfo.Course);
        if (!courseSheet) throw new Error(`Course sheet "${requestInfo.Course}" not found.`);

        const [year, month, day] = requestInfo.AbsenceDate.split('-').map(Number);
        const hoursToApprove = approvedHours.split(',').map(h => h.trim());
        const newLogRows = [];
        const newLogObjects = [];

        for (const hourStr of hoursToApprove) {
            // Handle time ranges (e.g. "9:40-10:30") by extracting the start time
            const timeMatch = hourStr.match(/(\d{1,2}):(\d{2})/);
            if (!timeMatch) throw new Error(`Invalid time format: ${hourStr}`);
            const hour = Number(timeMatch[1]);
            const minute = Number(timeMatch[2]);
            const logTimestamp = new Date(year, month - 1, day, hour, minute);
            const logTimestampMs = logTimestamp.getTime();
            const logId = `${logTimestampMs}_${studentUid}_manual`;

            const newLogObject = {
                uid: studentUid,
                timestamp: logTimestampMs,
                id: logId,
                manual: true,
                version: 1,
                updatedAt: new Date().getTime(),
                updatedBy: adminEmail,
                course: requestInfo.Course,
                session: requestInfo.Session
            };

            newLogRows.push([
                newLogObject.uid,
                logTimestamp.toISOString(),
                newLogObject.id,
                newLogObject.manual,
                newLogObject.version,
                new Date(newLogObject.updatedAt).toISOString(),
                newLogObject.updatedBy,
                newLogObject.session
            ]);

            newLogObjects.push(newLogObject);
        }

        if (newLogRows.length > 0) {
            courseSheet.getRange(courseSheet.getLastRow() + 1, 1, newLogRows.length, 8).setValues(newLogRows);
        }

        // --- 5. UPDATE STATUS (Using Dynamic Indices) ---
        const approvedMsg = `Approved ${hoursToApprove.length}/${originalHours.split(',').length} hours by ${adminEmail}`;

        // Note: We use (index + 1) because getRange uses 1-based column numbers
        absencesSheet.getRange(requestRow, statusIdx + 1).setValue("Approved");
        if (notesIdx !== -1) absencesSheet.getRange(requestRow, notesIdx + 1).setValue(approvedMsg);
        if (hoursIdx !== -1) absencesSheet.getRange(requestRow, hoursIdx + 1).setValue(approvedHours);

        // --- 6. SEND EMAIL ---
        sendAbsenceApprovalEmail(studentName, studentEmail, customMessage, approvedHours, originalHours, adminEmail, requestInfo.Course, logsSpreadsheetId);

        return {
            result: "success",
            message: `Approved ${newLogObjects.length} logs for ${studentName}.`,
            newLogs: newLogObjects
        };

    } catch (e) {
        Logger.log('Error approving absence: ' + e.message);
        return { result: "error", message: e.message };
    }
}


/**
 * Rejects an absence request:
 * 1. Updates status in 'ABSENCES' sheet.
 * 2. Sends a rejection email.
 */
function rejectAbsenceRequest(data, logsSpreadsheetId, adminEmail) {
    try {
        const { requestID, studentName, studentEmail, rejectionMessage, courseName, hours: originalHours } = data;

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const absencesSheet = ss.getSheetByName("ABSENCES");
        if (!absencesSheet) throw new Error('"ABSENCES" sheet not found.');

        // Find the request row
        const reqData = absencesSheet.getDataRange().getValues();
        const headers = reqData[0];
        const reqIdIdx = headers.indexOf("RequestID");

        let requestRow = -1;
        for (let i = 1; i < reqData.length; i++) {
            if (reqData[i][reqIdIdx] === requestID) {
                requestRow = i + 1; // 1-based index
                break;
            }
        }

        if (requestRow === -1) {
            throw new Error(`Request ID ${requestID} not found.`);
        }

        // --- 1. Update Status ---
        const statusIdx = headers.indexOf("Status");
        const adminNotesIdx = headers.indexOf("AdminNotes");

        absencesSheet.getRange(requestRow, statusIdx + 1).setValue("Rejected");
        absencesSheet.getRange(requestRow, adminNotesIdx + 1).setValue(rejectionMessage || `Rejected by ${adminEmail}`);

        // --- 2. Send Email ---
        const firstName = studentName ? studentName.split(' ')[0] : 'Student';
        const greeting = `Dear ${firstName},`;

        const formattedCourseName = courseName.replace(/_/g, ' ');
        const subject = `Permission Request for ${formattedCourseName}`;

        // Logic moved inside getSignatureForAdmin
        const signatureHtml = getSignatureForAdmin(adminEmail);

        const courseAdminsForReject = getAdminEmailsForCourse(logsSpreadsheetId, courseName);

        let hoursGridHtml = '';
        if (originalHours) {
            const rejHoursArray = originalHours.split(',').map(h => h.trim()).filter(Boolean);
            const rejHourPills = rejHoursArray.map(h =>
                `<td style="padding-right:6px;"><span style="display:inline-block;background:#f5f5f5;color:#999;font-weight:600;font-size:13px;padding:5px 12px;border-radius:4px;border:1px solid #ddd;">${h}</span></td>`
            ).join('');
            hoursGridHtml = `
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.8px;">Originally Requested</p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;"><tr>${rejHourPills}</tr></table>`;
        }

        let rejectionBoxHtml = '';
        if (rejectionMessage && rejectionMessage.trim() !== '') {
            rejectionBoxHtml = `
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.8px;">Reason</p>
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
                <tr><td style="background:#fdf5f5;border-left:3px solid #c0392b;padding:10px 14px;font-style:italic;color:#555;">
                  ${rejectionMessage.replace(/\n/g, '<br>')}
                </td></tr>
              </table>`;
        }

        const bodyHtml = `
            <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
              <p style="margin:0 0 16px;">${greeting}</p>
              <p style="margin:0 0 20px;">Your permission request for <strong>${formattedCourseName}</strong> has <span style="color:#c0392b;font-weight:600;">not been approved</span>.</p>
              ${hoursGridHtml}
              ${rejectionBoxHtml}
              <p style="margin:0 0 20px;">Please feel free to reach out if you have any questions.</p>
              ${signatureHtml}
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0 8px;">
              <p style="font-size:11px;color:#aaa;margin:0;">This is an automatically generated email. Please do not reply directly.</p>
            </div>
        `;

        const rejectEmailOptions = {
            to: `"${studentName}" <${studentEmail}>`,
            subject: subject,
            htmlBody: bodyHtml,
            name: APP_NAME
        };
        if (courseAdminsForReject.length > 0) rejectEmailOptions.cc = formatAdminEmailsForCC(courseAdminsForReject).join(', ');
        MailApp.sendEmail(rejectEmailOptions);

        return { result: "success", message: "Request rejected and email sent." };

    } catch (e) {
        Logger.log('Error rejecting absence: ' + e.message);
        return { result: "error", message: e.message };
    }
}


/**
 * Deletes an absence request. This PERMANENTLY removes the row.
 */
function deleteAbsenceRequest(data, logsSpreadsheetId, adminEmail) {
    try {
        const { requestID } = data;

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);
        const absencesSheet = ss.getSheetByName("ABSENCES");
        if (!absencesSheet) throw new Error('"ABSENCES" sheet not found.');

        const reqData = absencesSheet.getDataRange().getValues();
        const reqIdIdx = reqData[0].indexOf("RequestID");

        let requestRow = -1;
        for (let i = 1; i < reqData.length; i++) {
            if (reqData[i][reqIdIdx] === requestID) {
                requestRow = i + 1; // 1-based index
                break;
            }
        }

        if (requestRow > -1) {
            absencesSheet.deleteRow(requestRow);
            return { result: "success", message: "Request deleted." };
        } else {
            throw new Error(`Request ID ${requestID} not found.`);
        }

    } catch (e) {
        Logger.log('Error deleting absence: ' + e.message);
        return { result: "error", message: e.message };
    }
}

function getPendingRegistrations(logsSpreadsheetId, courseName) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const regSheet = ss.getSheetByName(REGISTRATION_SHEET_NAME);

        if (!regSheet) {
            throw new Error('Registrations sheet not found');
        }

        const data = regSheet.getDataRange().getValues();
        const registrations = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];

            registrations.push({
                rowNumber: i + 1,
                name: row[0] || '',
                uid: row[1] || '',
                email: row[2] || '',
                timestamp: row[3] || '',
                sentBy: row[4] || '',
            });
        }

        return registrations;

    } catch (e) {
        Logger.log('Error getting pending registrations: ' + e.message);
        throw new Error('Failed to fetch registrations: ' + e.message);
    }
}

function approveRegistration(data, logsSpreadsheetId, courseName, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const regSheet = ss.getSheetByName(REGISTRATION_SHEET_NAME);
        const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);

        if (!regSheet || !dbSheet) {
            throw new Error('Required sheets not found');
        }

        // Pass userEmail to the next function
        resolveApproval(dbSheet, regSheet, data, data.approvalMode, userEmail);

        return {
            result: 'success',
            message: 'Registration approved and processed'
        };

    } catch (e) {
        Logger.log('Error approving registration: ' + e.message);
        return {
            result: 'error',
            message: 'Failed to approve registration: ' + e.message
        };
    }
}

function rejectRegistration(data, logsSpreadsheetId, courseName, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const regSheet = ss.getSheetByName(REGISTRATION_SHEET_NAME);

        if (!regSheet) {
            throw new Error('Registrations sheet not found');
        }

        regSheet.deleteRow(data.rowNumber);

        if (data.email && data.message) {
            const signatureHtml = getSignatureForAdmin(userEmail);
            const firstName = data.name ? data.name.split(' ')[0] : 'Student';
            const messageHtml = data.message.replace(/\n/g, '<br>');

            const bodyHtml = `
        <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
          <p style="margin:0 0 16px;">Dear ${firstName},</p>
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
            <tr><td style="background:#fdf5f5;border-left:3px solid #c0392b;padding:10px 14px;color:#333;">
              ${messageHtml}
            </td></tr>
          </table>
          ${signatureHtml}
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0 8px;">
          <p style="font-size:11px;color:#aaa;margin:0;">This is an automatically generated email. Please do not reply directly.</p>
        </div>
      `;

            MailApp.sendEmail({
                to: `"${data.name}" <${data.email}>`,
                subject: 'Your Student ID Card Application has been Rejected',
                body: data.message,
                htmlBody: bodyHtml,
                name: APP_NAME
            });
        }

        return {
            result: 'success',
            message: 'Registration rejected'
        };

    } catch (e) {
        Logger.log('Error rejecting registration: ' + e.message);
        return {
            result: 'error',
            message: 'Failed to reject registration: ' + e.message
        };
    }
}

function deleteLog_Admin(data) {
    const { courseName, logId, logsSpreadsheetId } = data;

    if (!courseName || !logId || !logsSpreadsheetId) {
        return { result: 'error', message: 'Missing required parameters' };
    }

    try {
        const ss = SpreadsheetApp.openById(logsSpreadsheetId);

        // 1. Remove from course sheet
        const courseSheet = ss.getSheetByName(courseName);
        if (courseSheet) {
            const dataRange = courseSheet.getRange(2, 1, courseSheet.getLastRow() - 1, 7);
            const values = dataRange.getValues();

            for (let i = 0; i < values.length; i++) {
                if (values[i][2] === logId) { // Column C is ID
                    courseSheet.deleteRow(i + 2);
                    break;
                }
            }
        }

        // 2. Add to DELETED_LOG_IDS sheet (tombstone)
        let tombstoneSheet = ss.getSheetByName('DELETED_LOG_IDS');
        if (!tombstoneSheet) {
            tombstoneSheet = ss.insertSheet('DELETED_LOG_IDS');
            tombstoneSheet.getRange(1, 1, 1, 3).setValues([['Course', 'LogID', 'DeletedAt']]);
        }

        tombstoneSheet.appendRow([
            courseName,
            logId,
            new Date().toISOString()
        ]);

        return { result: 'success', message: 'Log deleted and tombstone recorded' };

    } catch (error) {
        return { result: 'error', message: error.toString() };
    }
}

function deleteEntryFromDatabase_Admin(data, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
        if (!dbSheet) throw new Error('Database sheet not found');

        const range = dbSheet.getDataRange();
        const values = range.getValues();
        const primaryKeyIndex = 0; // Column A

        let foundRowIndex = -1;
        // Start from i = 1 to skip header
        for (let i = 1; i < values.length; i++) {
            // Use '==' for type coercion, as sheet values can be numbers or strings
            if (values[i][primaryKeyIndex] == data.dbKey) {
                foundRowIndex = i + 1; // Sheet rows are 1-based
                break;
            }
        }

        if (foundRowIndex === -1) {
            throw new Error(`Student with key ${data.dbKey} not found in database.`);
        }

        dbSheet.deleteRow(foundRowIndex);

        return {
            result: 'success',
            message: 'Student deleted successfully'
        };

    } catch (e) {
        Logger.log('Error in deleteEntryFromDatabase_Admin: ' + e.message);
        return {
            result: 'error',
            message: e.message
        };
    }
}

function addEntryToDatabase_Admin(data, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
        if (!dbSheet) throw new Error('Database sheet not found');

        const lastRow = dbSheet.getLastRow();
        let nextIndex = 1;
        if (lastRow >= 2) {
            const lastIndexValue = dbSheet.getRange(lastRow, 1).getValue();
            if (typeof lastIndexValue === 'number' && Number.isInteger(lastIndexValue)) {
                nextIndex = lastIndexValue + 1;
            } else {
                nextIndex = lastRow;
            }
        }

        dbSheet.appendRow([nextIndex, data.name, data.uid, data.email]);

        return {
            result: 'success',
            message: 'Entry added directly to database'
        };
    } catch (e) {
        Logger.log('Error in addEntryToDatabase_Admin: ' + e.message);
        return {
            result: 'error',
            message: e.message
        };
    }
}

/**
 * Deletes a Trusted Device from the TRUSTED_DEVICES sheet.
 */
function deleteDevice_Admin(data) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const sheet = ss.getSheetByName(DEVICES_SHEET_NAME); // Ensure DEVICES_SHEET_NAME is defined as "TRUSTED_DEVICES" at top of file

        if (!sheet) {
            return { result: "error", message: "Trusted Devices sheet not found" };
        }

        const rowIndex = parseInt(data.rowIndex);

        // Safety check: ensure we don't delete the header (row 1) or invalid rows
        if (isNaN(rowIndex) || rowIndex < 2) {
            return { result: "error", message: "Invalid row index provided" };
        }

        // Delete the row
        sheet.deleteRow(rowIndex);

        return { result: "success" };

    } catch (e) {
        Logger.log("Error deleting device: " + e.message);
        return { result: "error", message: e.message };
    }
}

function syncDatabase_Admin(databaseData, logsSpreadsheetId, courseName) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);

        if (!dbSheet) {
            throw new Error('Database sheet not found');
        }

        const lastRow = dbSheet.getLastRow();
        if (lastRow > 1) {
            dbSheet.getRange(2, 1, lastRow - 1, dbSheet.getLastColumn()).clearContent();
        }

        const dataArray = Object.keys(databaseData).map((key, index) => {
            const entry = databaseData[key];
            return [
                index + 1,
                entry.name,
                Array.isArray(entry.uids) ? entry.uids.join(', ') : entry.uids.toString(),
                entry.email || ''
            ];
        });

        if (dataArray.length > 0) {
            dbSheet.getRange(2, 1, dataArray.length, 4).setValues(dataArray);
        }

        return {
            result: 'success',
            message: 'Database synced successfully',
            count: dataArray.length
        };

    } catch (e) {
        Logger.log('Error syncing database: ' + e.message);
        return {
            result: 'error',
            message: 'Failed to sync database: ' + e.message
        };
    }
}

function getCourseLogs_Admin(courseName, logsSpreadsheetId, userEmail) {
    try {
        const adminAccess = checkAdminAccess(logsSpreadsheetId, courseName, userEmail);
        if (!adminAccess.hasAccess) throw new Error('Authorization Error');

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);

        // 1. Get all deleted log IDs (Tombstones) WITH TIMESTAMPS
        const tombstoneSheet = ss.getSheetByName('DELETED_LOG_IDS');
        // Change: Use a Map to store ID -> DeletedAt (timestamp)
        const deletedMap = {};

        if (tombstoneSheet) {
            const tombstoneData = tombstoneSheet.getDataRange().getValues();
            for (let i = 1; i < tombstoneData.length; i++) {
                // Column A: Course, Column B: LogID, Column C: DeletedAt
                if (tombstoneData[i][0] === courseName) {
                    const logId = tombstoneData[i][1];
                    const deletedAtStr = tombstoneData[i][2];
                    const deletedAt = deletedAtStr ? new Date(deletedAtStr).getTime() : 0;

                    // Store the timestamp. If duplicate, keep the latest deletion time.
                    if (!deletedMap[logId] || deletedAt > deletedMap[logId]) {
                        deletedMap[logId] = deletedAt;
                    }
                }
            }
        }

        // 2. Get course logs (Standard logic...)
        const courseSheet = ss.getSheetByName(courseName);
        const logs = [];

        if (courseSheet) {
            const logsData = courseSheet.getDataRange().getValues();
            for (let i = 1; i < logsData.length; i++) {
                const row = logsData[i];
                const logId = row[2] || '';
                const updatedAt = row[5] ? new Date(row[5]).getTime() : 0;

                // Only skip if the log exists in tombstones AND is older than the deletion
                if (deletedMap[logId] && updatedAt < deletedMap[logId]) {
                    continue;
                }

                logs.push({
                    uid: row[0] || '',
                    timestamp: new Date(row[1]).getTime(),
                    id: logId,
                    manual: row[3] === true || row[3] === 'true',
                    version: row[4] || 1,
                    updatedAt: updatedAt,
                    updatedBy: row[6] || '',
                    session: row[7] || ''
                });
            }
        }

        return {
            logs: logs,
            // Return objects instead of just strings
            tombstones: Object.keys(deletedMap).map(id => ({ id: id, deletedAt: deletedMap[id] }))
        };

    } catch (e) {
        throw new Error('Failed to fetch logs: ' + e.message);
    }
}

function syncCourseLogs_Admin(courseName, logsData, tombstones, logsSpreadsheetId, userEmail) {
    try {
        const adminAccess = checkAdminAccess(logsSpreadsheetId, courseName, userEmail);
        if (!adminAccess.hasAccess) {
            throw new Error('Not authorized to sync this course');
        }

        const ss = SpreadsheetApp.openById(logsSpreadsheetId);

        // --- 1. PROCESS TOMBSTONES (Record Deletions) ---
        if (tombstones && Array.isArray(tombstones) && tombstones.length > 0) {
            let tombstoneSheet = ss.getSheetByName('DELETED_LOG_IDS');
            if (!tombstoneSheet) {
                tombstoneSheet = ss.insertSheet('DELETED_LOG_IDS');
                tombstoneSheet.getRange(1, 1, 1, 3).setValues([['Course', 'LogID', 'DeletedAt']]);
            }

            const newTombstoneRows = tombstones.map(id => [
                courseName,
                id,
                new Date().toISOString()
            ]);

            tombstoneSheet.getRange(tombstoneSheet.getLastRow() + 1, 1, newTombstoneRows.length, 3).setValues(newTombstoneRows);
        }

        // --- 2. UPDATE COURSE LOGS ---
        const sheet = ss.getSheetByName(courseName);
        if (!sheet) {
            throw new Error(`Course sheet ${courseName} not found`);
        }

        // Clear existing content
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
            const lastCol = sheet.getLastColumn();
            // Clear up to column 8 (H) to include the Session column
            sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, 8)).clearContent();
        }

        // Map logs to row array
        const rows = logsData.map(log => [
            log.uid,
            new Date(log.timestamp).toISOString(),
            log.id,
            log.manual || false,
            log.version || 1,
            log.updatedAt ? new Date(log.updatedAt).toISOString() : '',
            log.updatedBy || userEmail,
            log.session || ''
        ]);

        if (rows.length > 0) {
            sheet.getRange(2, 1, rows.length, 8).setValues(rows);
        }

        return {
            result: 'success',
            message: `${rows.length} logs synced, ${tombstones ? tombstones.length : 0} deletions recorded`,
            count: rows.length
        };

    } catch (e) {
        Logger.log(`Error syncing course logs: ${e.message}`);
        return {
            result: 'error',
            message: e.message
        };
    }
}

/**
 * Gets all Global Admin emails from the Sheet + Fallback list.
 */
function getAllGlobalAdminEmails() {
    let globalEmails = [...FALLBACK_GLOBAL_ADMINS]; // Start with fallback

    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const sheet = ss.getSheetByName(STAFF_SHEET_NAME);

        if (sheet) {
            const data = sheet.getDataRange().getValues();
            // Skip header (row 0). Email is Col C (idx 2), Role is Col D (idx 3)
            for (let i = 1; i < data.length; i++) {
                const email = String(data[i][2]).trim();
                const role = String(data[i][3]).trim().toLowerCase();

                if (email && role === 'global') {
                    globalEmails.push(email);
                }
            }
        }
    } catch (e) {
        Logger.log("Error fetching global admins: " + e);
    }

    // Return unique list
    return [...new Set(globalEmails)];
}

/**
 * Returns the appropriate email signature based on the admin's email.
 * Includes the closing salutation ("Best," or "Best, Bredli").
 * @param {string} adminEmail The email of the admin performing the action.
 * @returns {string} An HTML string containing the closing and the signature table.
 */
function getSignatureForAdmin(adminEmail) {
    // Use FALLBACK_GLOBAL_ADMINS instead of ADMIN_EMAILS
    const isGlobalOwner = FALLBACK_GLOBAL_ADMINS.some(admin =>
        admin.trim().toLowerCase() === adminEmail.trim().toLowerCase()
    );

    let closingHtml = '';
    let signatureContent = '';

    if (isGlobalOwner) {
        // Global Admin Closing
        closingHtml = `<p>Best,<br>Bredli</p>`;
        signatureContent = getSignatureHtml(); // Returns the tbody content
    } else {
        // Look up the acting admin's first name from STAFF_KEYS
        let adminFirstName = '';
        try {
            const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
            const staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
            if (staffSheet) {
                const staffData = staffSheet.getDataRange().getValues();
                for (let i = 1; i < staffData.length; i++) {
                    if (String(staffData[i][2]).trim().toLowerCase() === adminEmail.trim().toLowerCase()) {
                        adminFirstName = String(staffData[i][0]).trim().split(' ')[0];
                        break;
                    }
                }
            }
        } catch (e) {
            Logger.log('Could not look up admin name for signature: ' + e);
        }

        return adminFirstName ? `<p>Best,<br>${adminFirstName}</p>` : `<p>Best,</p>`;
    }

    return `${closingHtml}<table cellpadding="0" cellspacing="0" border="0">${signatureContent}</table>`;
}

function getSignatureHtml() {
    const signature = `<tbody><tr><td style="padding:15px 0px;vertical-align:top"><table cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid rgb(0,83,161);padding-left:12px;padding-bottom:10px"><tbody><tr><td style="padding-bottom:5px"><span style="font-weight:800;color:rgb(0,83,161);font-size:14px">Bredli PLAKU</span><br><span style="font-size:12px;color:rgb(0,0,0)">Assistant Lecturer | MSc</span><br><span style="color:rgb(0,83,161);font-size:12px">Department of Civil Engineering</span><br><span style="color:rgb(0,83,161);font-size:12px">Faculty of Architecture and Engineering</span><br></td></tr><tr><td style="padding-bottom:3px"><a href="https://ce.epoka.edu.al" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit;"><span style="color:rgb(0,83,161);font-size:12px"><img alt="EPOKA University" width="161" height="21" src="https://bredliplaku.com/miscellaneous/Email_Signature.png"></span></a></td></tr><tr><td><table cellpadding="0" cellspacing="0" border="0" style="font-size:12px"><tbody><tr><td style="padding-bottom:3px;width:60px"><strong>Website:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)"><a href="https://bredliplaku.com" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;">bredliplaku.com</a></td></tr><tr><td style="padding-bottom:3px;width:60px"><strong>Office:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)">A-032</td></tr><tr><td style="padding-bottom:3px;width:60px"><strong>Phone:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)">+355 42 232 086 ext. 1556</td></tr><tr><td style="padding-bottom:3px;width:60px"><strong>Email:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)">bplaku@epoka.edu.al</td></tr><tr><td style="padding-bottom:3px;width:60px;vertical-align:top"><strong>Address:</strong></td><td style="color:rgb(0,0,0)">Rruga Tiranë-Rinas, Km. 12<br>1032 Vorë, Tirana, Albania 🇦🇱</td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody>`;
    return signature;
}

function deleteRegistration(data, logsSpreadsheetId, courseName) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const regSheet = ss.getSheetByName(REGISTRATION_SHEET_NAME);

        if (!regSheet) {
            throw new Error('Registrations sheet not found');
        }

        // Parse data.rowNumber to an integer and check if it's a valid number.
        const rowNum = parseInt(data.rowNumber);
        if (rowNum && !isNaN(rowNum) && rowNum >= 2) {
            regSheet.deleteRow(rowNum); // Use the parsed number
            return {
                result: 'success',
                message: 'Registration deleted'
            };
        } else {
            // This is the error you were seeing
            throw new Error('Invalid row number provided');
        }

    } catch (e) {
        Logger.log('Error deleting registration: ' + e.message);
        return {
            result: 'error',
            message: 'Failed to delete registration: ' + e.message
        };
    }
}

function resolveApproval(dbSheet, regSheet, data, mode, userEmail) {
    if (mode === 'custom_replace') {
        const rowIndexToUpdate = data.duplicateRowIndex;
        const updates = data.updates || {};

        if (!rowIndexToUpdate || rowIndexToUpdate < 2) {
            throw new Error("Invalid or missing 'duplicateRowIndex' for custom_replace mode.");
        }

        const range = dbSheet.getRange(rowIndexToUpdate, 1, 1, 4);
        const rowValues = range.getValues()[0];

        if (updates.name) rowValues[1] = data.name;
        if (updates.email) rowValues[3] = data.email;

        if (updates.uid_action) {
            const currentUidString = rowValues[2] ? rowValues[2].toString().trim() : '';
            if (updates.uid_action === 'merge') {
                const existingUids = currentUidString.split(',').map(s => s.trim()).filter(Boolean);
                if (!existingUids.includes(data.uid.trim())) {
                    rowValues[2] = currentUidString ? `${currentUidString}, ${data.uid.trim()}` : data.uid.trim();
                }
            } else if (updates.uid_action === 'replace') {
                rowValues[2] = data.uid.trim();
            }
        }
        range.setValues([rowValues]);

    } else {
        const lastRowIndex = dbSheet.getLastRow();
        let newIndex = 1;
        if (lastRowIndex >= 2) {
            const lastIndexValue = dbSheet.getRange(lastRowIndex, 1).getValue();
            if (typeof lastIndexValue === 'number' && Number.isInteger(lastIndexValue)) {
                newIndex = lastIndexValue + 1;
            } else {
                newIndex = lastRowIndex;
            }
        }
        dbSheet.appendRow([newIndex, data.name, data.uid, data.email]);
    }

    sendApprovalEmail(data, userEmail);

    // Parse data.rowNumber to an integer and check if it's a valid number.
    const rowNum = parseInt(data.rowNumber);
    if (rowNum && !isNaN(rowNum) && rowNum >= 2) {

        // Get a fresh reference to the sheet *after* the email call
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const freshRegSheet = ss.getSheetByName(REGISTRATION_SHEET_NAME);

        if (freshRegSheet) {
            freshRegSheet.deleteRow(rowNum); // Use the parsed number
        } else {
            Logger.log('Could not find registration sheet to delete row ' + rowNum);
        }
    } else {
        // Log if the row number was bad, but don't stop the function
        Logger.log('Invalid rowNumber received in resolveApproval: ' + data.rowNumber);
    }
}

function sendApprovalEmail(data, adminEmail) {
    let firstName = "Student";
    let greeting = "Dear,";
    if (data.name && data.name.trim() !== '') {
        firstName = data.name.split(' ')[0];
        greeting = `Dear ${firstName},`;
    }

    const subject = "Your Student ID Card Application has been Approved";

    // Plain text body
    const bodyPlainText = `${greeting}\nI hope this email finds you well.\n\nThis is to inform you that your application for your Student ID Card has been approved.\nPlease ensure you always bring your student ID card with you to class, as you are responsible for your attendance if you do not bring it.\n\nYou may visit attendance.bredliplaku.com to see your attendance records after they have been recorded.\n\nBest,\nBredli`;

    // Logic moved inside getSignatureForAdmin (includes closing and table)
    const signatureHtml = getSignatureForAdmin(adminEmail);

    const bodyHtml = `
      <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
        <p style="margin:0 0 16px;">${greeting}<br>I hope this email finds you well.</p>
        <p style="margin:0 0 20px;">Your application for your <strong>Student ID Card</strong> has been <span style="color:#1a7c3e;font-weight:600;">approved</span>.</p>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
          <tr><td style="background:#f0f7f1;border-left:3px solid #1a7c3e;padding:10px 14px;font-size:13px;color:#333;">
            Please ensure you always bring your student ID card to class. You are responsible for your own attendance if you do not have it with you.
          </td></tr>
        </table>
        <p style="margin:0 0 20px;font-size:13px;color:#555;">Track your attendance at <a href="https://attendance.bredliplaku.com" target="_blank" style="color:#0053A1;">attendance.bredliplaku.com</a>.</p>
        ${signatureHtml}
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0 8px;">
        <p style="font-size:11px;color:#aaa;margin:0;">This is an automatically generated email. Please do not reply directly.</p>
      </div>
    `;

    MailApp.sendEmail({
        to: `"${data.name}" <${data.email}>`,
        subject: subject,
        body: bodyPlainText,
        htmlBody: bodyHtml,
        name: APP_NAME
    });
}

/**
 * Sends a customisable approval email for an absence request.
 */
function sendAbsenceApprovalEmail(studentName, studentEmail, customMessage, approvedHours, originalHours, adminEmail, courseName, logsSpreadsheetId) {
    try {
        const formattedCourseName = courseName.replace(/_/g, ' ');
        const subject = `Permission Request for ${formattedCourseName}`;

        // Logic moved inside getSignatureForAdmin
        const signatureHtml = getSignatureForAdmin(adminEmail);

        const firstName = studentName ? studentName.split(' ')[0] : 'Student';
        const greeting = `Dear ${firstName},`;

        const isPartial = approvedHours !== originalHours;
        const statusText = isPartial ? 'partially approved' : 'approved';

        const allHoursArray = originalHours.split(',').map(h => h.trim()).filter(Boolean);
        const approvedSet = new Set(approvedHours.split(',').map(h => h.trim()));

        const hourPills = allHoursArray.map(h => {
            const approved = approvedSet.has(h);
            const color = approved ? '#1a7c3e' : '#999';
            const bg = approved ? '#eaf5ec' : '#f5f5f5';
            const border = approved ? '#a8d5b4' : '#ddd';
            return `<td style="padding-right:6px;"><span style="display:inline-block;background:${bg};color:${color};font-weight:600;font-size:13px;padding:5px 12px;border-radius:4px;border:1px solid ${border};">${h}</span></td>`;
        }).join('');

        let customMessageHtml = '';
        if (customMessage && customMessage.trim() !== '') {
            customMessageHtml = `
              <blockquote style="border-left:3px solid #ddd;margin:0 0 20px;padding:8px 14px;color:#555;font-style:italic;">
                ${customMessage.replace(/\n/g, '<br>')}
              </blockquote>`;
        }

        const bodyHtml = `
            <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
              <p style="margin:0 0 16px;">${greeting}</p>
              <p style="margin:0 0 12px;">Your permission request for <strong>${formattedCourseName}</strong> has been <strong>${statusText}</strong> for the following hours:</p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;"><tr>${hourPills}</tr></table>
              ${customMessageHtml}
              ${signatureHtml}
              <hr style="border:none;border-top:1px solid #eee;margin:20px 0 8px;">
              <p style="font-size:11px;color:#aaa;margin:0;">This is an automatically generated email. Please do not reply directly.</p>
            </div>
        `;

        const courseAdminsForApprove = logsSpreadsheetId ? getAdminEmailsForCourse(logsSpreadsheetId, courseName) : [];
        const approveEmailOptions = {
            to: `"${studentName}" <${studentEmail}>`,
            subject: subject,
            htmlBody: bodyHtml,
            name: APP_NAME
        };
        if (courseAdminsForApprove.length > 0) approveEmailOptions.cc = formatAdminEmailsForCC(courseAdminsForApprove).join(', ');
        MailApp.sendEmail(approveEmailOptions);

        return true;

    } catch (e) {
        Logger.log(`Failed to send approval email to ${studentEmail}: ${e.message}`);
        return false;
    }
}

function updateStudentInDatabase_Admin(data, userEmail) {
    try {
        const ss = SpreadsheetApp.openById(DATABASE_SPREADSHEET_ID);
        const dbSheet = ss.getSheetByName(DATABASE_SHEET_NAME);
        if (!dbSheet) throw new Error('Database sheet not found');

        const range = dbSheet.getDataRange();
        const values = range.getValues();
        const primaryKeyIndex = 0;

        let foundRow = -1;
        for (let i = 1; i < values.length; i++) {
            if (values[i][primaryKeyIndex] == data.dbKey) {
                foundRow = i + 1;
                break;
            }
        }

        if (foundRow === -1) {
            throw new Error(`Student with key ${data.dbKey} not found in database.`);
        }

        dbSheet.getRange(foundRow, 2).setValue(data.name);
        dbSheet.getRange(foundRow, 3).setValue(data.uids.join(', '));
        dbSheet.getRange(foundRow, 4).setValue(data.email);

        return {
            result: 'success',
            message: 'Student updated successfully'
        };

    } catch (e) {
        Logger.log('Error in updateStudentInDatabase_Admin: ' + e.message);
        return {
            result: 'error',
            message: e.message
        };
    }
}

/**
 * Runs a full diagnostic check on the script's core functions and connections.
 * Includes checks for Kiosk Mode (Staff Keys & Trusted Devices).
 * Select this function from the "Run" menu and check the logs.
 */
function runDiagnostics() {
    // --- Configuration for Diagnostics ---
    const TEST_GLOBAL_ADMIN_EMAIL = "bplaku@epoka.edu.al";
    const TEST_NON_GLOBAL_ADMIN_EMAIL = "egoga@epoka.edu.al";

    // 1. Setup IDs
    // We assume DATABASE_SPREADSHEET_ID is defined at the top of Backend.js
    const DB_ID = DATABASE_SPREADSHEET_ID;

    // We need the Logs ID. Usually passed from frontend, but for diagnostics we hardcode your known ID.
    // This is the ID of the sheet containing 'COURSE_INFO', 'ABSENCES', etc.
    const LOGS_ID = "1AvVrBRt4_3GJTVMmFph6UsUsplV9h8jXU93n1ezbMME";

    const results = [];
    Logger.log('🚀 Running Full Diagnostics... 🚀');
    results.push('🚀 Running Full Diagnostics... 🚀');

    // --- 1. Core Connections ---
    results.push('\n--- 1. Core Connections ---');
    try {
        const db = getDatabase();
        const dbSize = Object.keys(db).length;
        results.push(dbSize > 0 ? `  [OK] Main Database: Connected (${dbSize} entries)` : `  [WARN]  Main Database: Connected (EMPTY)`);
    } catch (e) { results.push(`  [ERR] Main Database (ID: ${DB_ID}): ${e.message}`); }

    let ss;
    try {
        ss = SpreadsheetApp.openById(LOGS_ID);
        const infoSheet = ss.getSheetByName('COURSE_INFO');
        if (infoSheet) {
            results.push(`  [OK] Logs Spreadsheet: Connected ('COURSE_INFO' found)`);
            // Check for new columns
            const headers = infoSheet.getRange(1, 1, 1, infoSheet.getLastColumn()).getValues()[0].map(h => h.toLowerCase());
            if (headers.includes('admin_emails')) results.push(`  [OK] COURSE_INFO: 'admin_emails' column found.`);
            else results.push(`  [WARN] COURSE_INFO: 'admin_emails' column MISSING.`);
        } else {
            results.push(`  [ERR] Logs Spreadsheet: 'COURSE_INFO' sheet NOT found`);
        }
    } catch (e) { results.push(`  [ERR] Logs Spreadsheet (ID: ${LOGS_ID}): ${e.message}`); }

    // --- 2. Access Control (Full Status) ---
    results.push('\n--- 2. Access Control (Full Status) ---');
    try {
        const globalStatus = checkUserAdminStatus(LOGS_ID, TEST_GLOBAL_ADMIN_EMAIL);
        results.push(`  [OK] Global Admin (${TEST_GLOBAL_ADMIN_EMAIL}): Status OK (isGlobal=${globalStatus.isGlobalAdmin}, isAdmin=${globalStatus.isAdmin})`);
    } catch (e) { results.push(`  [ERR] Global Admin Status: ${e.message}`); }

    try {
        const courseAdminStatus = checkUserAdminStatus(LOGS_ID, TEST_NON_GLOBAL_ADMIN_EMAIL);
        // Note: If egoga is not in any course yet, this warning is expected.
        if (courseAdminStatus.isAdmin) {
            results.push(`  [OK] Course Admin (${TEST_NON_GLOBAL_ADMIN_EMAIL}): Status OK (${courseAdminStatus.courses.length} courses)`);
        } else {
            results.push(`  [INFO]  Course Admin (${TEST_NON_GLOBAL_ADMIN_EMAIL}): Not an admin currently.`);
        }
    } catch (e) { results.push(`  [ERR] Course Admin Status: ${e.message}`); }

    // --- 3. Boot Data ---
    results.push('\n--- 3. Boot Data (getBootData) ---');
    try {
        const adminBoot = getBootData(LOGS_ID, TEST_GLOBAL_ADMIN_EMAIL);
        const courseCount = adminBoot.courses ? Object.keys(adminBoot.courses).length : 0;
        const dbCount = adminBoot.database ? Object.keys(adminBoot.database).length : 0;
        results.push(`  [OK] Admin Boot: OK (${courseCount} courses, ${dbCount} db entries)`);
    } catch (e) { results.push(`  [ERR] Admin Boot: ${e.message}`); }

    // --- 4. Log Fetching ---
    results.push('\n--- 4. Log Fetching ---');
    try {
        const boot = getBootData(LOGS_ID, TEST_GLOBAL_ADMIN_EMAIL);
        const courses = boot.courses || {};
        const firstCourse = Object.keys(courses)[0];

        if (firstCourse) {
            const adminLogs = getCourseLogs_Admin(firstCourse, LOGS_ID, TEST_GLOBAL_ADMIN_EMAIL);
            results.push(`  [OK] Admin Logs (${firstCourse}): OK (${adminLogs.length} logs)`);
        } else {
            results.push(`  [WARN]  Skipping Log Fetch: No available courses found.`);
        }
    } catch (e) { results.push(`  [ERR] Admin Logs Fetch: ${e.message}`); }

    // --- 5. 'ABSENCES' Sheet Integrity ---
    results.push('\n--- 5. \'ABSENCES\' Sheet Integrity ---');
    if (ss) {
        try {
            const sheet = ss.getSheetByName("ABSENCES");
            if (!sheet) {
                results.push(`  [ERR] 'ABSENCES' Sheet: NOT FOUND.`);
            } else {
                const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
                const cleanHeaders = headers.map(h => h.toString().trim().toLowerCase());
                const urlIdx = cleanHeaders.indexOf("attachmenturl");

                if (urlIdx > -1) {
                    results.push(`  [OK] 'ABSENCES' Sheet: Found. 'AttachmentURL' header OK.`);
                } else {
                    results.push(`  [ERR] 'ABSENCES' Sheet: 'AttachmentURL' header MISSING.`);
                }
            }
        } catch (e) { results.push(`  [ERR] 'ABSENCES' Sheet: Error reading sheet. ${e.message}`); }
    }

    // --- 6. Kiosk & Security Infrastructure ---
    results.push('\n--- 6. Kiosk & Security Infrastructure ---');
    try {
        const dbSS = SpreadsheetApp.openById(DB_ID);

        // Check STAFF_KEYS
        const staffSheet = dbSS.getSheetByName("STAFF_KEYS");
        if (staffSheet) {
            const headers = staffSheet.getRange(1, 1, 1, 4).getValues()[0]; // Checking first 4 columns
            const headerStr = headers.map(h => String(h).trim().toLowerCase()).join(',');

            // Ensure 'Role' column exists
            if (headerStr.includes('name') && headerStr.includes('uid') && headerStr.includes('email') && headerStr.includes('role')) {
                results.push("  [OK] 'STAFF_KEYS' Sheet: Found & Headers OK (Name, UID, Email, Role).");
            } else {
                results.push(`  [WARN] 'STAFF_KEYS' Headers might be outdated: [${headers.join(', ')}]. Expected 'Role' column.`);
            }
        } else {
            results.push("  [ERR] 'STAFF_KEYS' Sheet: NOT FOUND. NFC Login will fail.");
        }

        // Check TRUSTED_DEVICES
        const deviceSheet = dbSS.getSheetByName("TRUSTED_DEVICES");
        if (deviceSheet) {
            results.push("  [OK] 'TRUSTED_DEVICES' Sheet: Found.");
        } else {
            results.push("  [ERR] 'TRUSTED_DEVICES' Sheet: NOT FOUND. Device checks will fail.");
        }

        // Check Script Cache
        try {
            const cache = CacheService.getScriptCache();
            cache.put("DIAGNOSTIC_TEST", "OK", 10);
            const val = cache.get("DIAGNOSTIC_TEST");
            if (val === "OK") {
                results.push("  [OK] Script Cache: Operational.");
            } else {
                results.push("  [ERR] Script Cache: Write/Read failed.");
            }
        } catch (c) {
            results.push(`  [ERR] Script Cache Error: ${c.message}`);
        }

    } catch (e) {
        results.push(`  [ERR] Kiosk Infrastructure Error: ${e.message}`);
    }

    // --- 7. Final Summary ---
    results.push('\n--- Diagnostics Complete ---');
    Logger.log(results.join('\n'));
}