
// FIRST STEP: Go to ASR calendar, and find the mget requests, then copy the response into your console, then clean the data with this function.

/**
 * Cleans and transforms a JSON object from a data source to be concise
 * and readable for an LLM. It simplifies keys, converts timestamps,
 * replaces ID lists with counts, and removes irrelevant metadata.
 * This version is robust and will not error on malformed entries in the input array.
 *
 * @param {object} rawData The raw JSON object, expected to have a `docs` property.
 * @returns {object} A new object containing the cleaned event data.
 */
function cleanJsonForLLM(rawData) {
    if (!rawData || !Array.isArray(rawData.docs)) {
        console.error("Invalid input data structure. Expected an object with a 'docs' array.");
        return { events: [] };
    }

    // A map for simple key-to-key renaming and cleaning.
    const KEY_MAP = {
        "event_title_text": "title",
        "event_details_text": "details",
        "event_status_text": "status",
        "event_location_text": "location",
        "academic_year_option_academic_years": "academic_year",
        "year_option_year": "year",
        "module_option_modules": "module",
        "speciality_option_speciality": "speciality",
        "cpp_module_option_speciality": "cpp_speciality",
        "student_count_number": "student_count",
        "event_duration_hrs_number": "duration_hours",
        "online_boolean": "is_online",
        "cpp_boolean": "is_cpp",
        "event_canceled_boolean": "is_cancelled",
        "site_option_sites": "site",
    };

    const cleanedEvents = rawData.docs.map(doc => {
        // *** FIX IS HERE: Safely handle null docs or docs without a _source ***
        if (!doc || !doc._source) {
            return null; // This will be filtered out later
        }

        const source = doc._source;
        const cleanedEvent = {};

        // 1. Rename keys and copy simple values
        for (const [originalKey, newKey] of Object.entries(KEY_MAP)) {
            if (source[originalKey] != null) {
                let value = source[originalKey];
                if (newKey === 'year' && typeof value === 'string') {
                    value = value.replace(/_/g, '');
                }
                cleanedEvent[newKey] = value;
            }
        }

        // 2. Convert timestamps to ISO strings
        if (source.strat_date_and_time_date) {
            cleanedEvent.start_time_utc = new Date(source.strat_date_and_time_date).toISOString();
        }
        if (source.end_date_and_time_date) {
            cleanedEvent.end_time_utc = new Date(source.end_date_and_time_date).toISOString();
        }

        // 3. Summarize lists into counts
        if (Array.isArray(source.teachers_list_user)) {
            cleanedEvent.teacher_count = source.teachers_list_user.length;
        }
        if (Array.isArray(source.attended_yes_list_custom_student_info)) {
            cleanedEvent.attendance_yes_count = source.attended_yes_list_custom_student_info.length;
        }
        if (Array.isArray(source.attended_no_list_custom_student_info)) {
            cleanedEvent.attendance_no_count = source.attended_no_list_custom_student_info.length;
        }

        return cleanedEvent;
    })
    // 4. Filter out any null results from bad data or unwanted events
    .filter(event => event && event.status !== "Archived" && event.title);

    return { events: cleanedEvents };
}


// THIS IS TO COMBINE MULTIPLE MGETS together
const events = [data1,data2,data3,data4].map(d => cleanJsonForLLM(d)).reduce((arr, e) => [...arr, ...e.events],[])


// THIS IS TO DOWNLOAD THE DATA AS CSV
/**
 * Converts an array of objects (JSON) into a CSV format and triggers a browser download.
 *
 * This function handles:
 * - Dynamically generating headers from all unique keys in the data.
 * - Correctly formatting UTC date strings into a 'YYYY-MM-DD HH:MM:SS' format that Excel recognizes.
 * - Escaping CSV content (commas, quotes, newlines) to prevent data corruption.
 * - Adding a BOM (Byte Order Mark) to ensure proper UTF-8 character handling in Excel.
 *
 * @param {Array<Object>} jsonData The array of objects to convert.
 * @param {string} [filename='data.csv'] The desired name for the downloaded file.
 */
function downloadJsonAsCsv(jsonData, filename = 'data.csv') {
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
        console.error("Invalid or empty data provided. Please provide an array of objects.");
        return;
    }

    // Helper function to format UTC date strings into a format Excel understands
    const formatDateForExcel = (dateString) => {
        if (!dateString || typeof dateString !== 'string') return '';
        
        const date = new Date(dateString);
        // Check for invalid dates (e.g., from incorrect parsing or old placeholder data)
        if (isNaN(date.getTime()) || date.getUTCFullYear() < 1980) {
             return dateString; // Return original string if it's not a valid or modern date
        }
        
        const pad = (num) => String(num).padStart(2, '0');
        
        const year = date.getUTCFullYear();
        const month = pad(date.getUTCMonth() + 1);
        const day = pad(date.getUTCDate());
        const hours = pad(date.getUTCHours());
        const minutes = pad(date.getUTCMinutes());
        const seconds = pad(date.getUTCSeconds());

        // A standard, unambiguous format that Excel correctly interprets as a date and time
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    // Helper function to escape special characters for a CSV cell
    const escapeCsvCell = (cell) => {
        const strCell = String(cell ?? ''); // Handle null/undefined values by converting to empty string
        // If the cell contains a comma, a newline, or a double-quote, wrap it in double-quotes
        if (/[",\n]/.test(strCell)) {
            // Also, any double-quotes inside the cell must be escaped by doubling them
            return `"${strCell.replace(/"/g, '""')}"`;
        }
        return strCell;
    };
    
    // 1. Get all unique headers from every object in the data array to create a complete header row
    const headers = Array.from(
        jsonData.reduce((acc, obj) => {
            if (obj && typeof obj === 'object') {
              Object.keys(obj).forEach(key => acc.add(key));
            }
            return acc;
        }, new Set())
    );

    // 2. Create the header row
    const headerRow = headers.join(',');

    // 3. Create the data rows
    const dataRows = jsonData.map(row => 
        headers.map(header => {
            const value = row[header];
            // Check if the header is for a date and format it accordingly
            if ((header === 'start_time_utc' || header === 'end_time_utc')) {
                return escapeCsvCell(formatDateForExcel(value));
            }
            return escapeCsvCell(value);
        }).join(',')
    );
    
    // 4. Combine headers and rows, and add a BOM (Byte Order Mark) for Excel to correctly open UTF-8 files
    const csvString = '\uFEFF' + [headerRow, ...dataRows].join('\n');
    
    // 5. Create a Blob object and trigger the download
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    
    const link = document.createElement('a');
    if (link.download !== undefined) { // Check for browser support for the download attribute
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}
