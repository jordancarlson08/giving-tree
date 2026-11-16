import { google } from 'googleapis';

const SPREADSHEET_ID = '1VuSew17HE4-WdRfl3SAZKgjF1wS-Sr6DSKrm2tgRRR4';
const SHEET_NAME = 'Sheet1'; // Change if your sheet has a different name

// Columns returned to the public page. Anything else in the sheet (recipient,
// addresses, internal notes, claimer names) is never sent to the browser.
const PUBLIC_FIELDS = ['id', 'item', 'shouldWrap', 'other', 'url', 'previewUrl', 'deliverTo'];
const MAX_NAME_LENGTH = 200;

// Rate limiting: simple in-memory store (resets on serverless function restart)
const rateLimitStore = new Map();
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

// Allowed origins for CORS
function getAllowedOrigins() {
  const origins = ['http://localhost:3000']; // Local development
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(...process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()));
  }
  // Add Vercel deployment URL if available
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }
  return origins;
}

// Check rate limit
function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip;
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  const limit = rateLimitStore.get(key);
  
  // Reset if window expired
  if (now > limit.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  // Check if over limit
  if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Sanitize value to prevent formula injection in Google Sheets
function sanitizeSheetValue(value) {
  if (typeof value !== 'string') {
    value = String(value);
  }

  // Limit length to prevent abuse (before prefixing, so every value is capped)
  value = value.trim().slice(0, MAX_NAME_LENGTH);

  // Prevent formula injection by prefixing dangerous characters with single quote
  // Google Sheets will treat it as text if it starts with a quote
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }

  return value;
}

// Validate ID format
function validateId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }
  // Allow alphanumeric, dashes, underscores only
  return /^[a-zA-Z0-9_-]+$/.test(id.trim());
}

// Service account JSON comes from the GOOGLE_SERVICE_ACCOUNT env var
// (Vercel project settings in production, .env.local for `vercel dev`)
function getCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT not set');
  }
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  } catch (e) {
    throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT');
  }
}

// Convert row array to object based on headers
function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    if (header && row[index] !== undefined) {
      obj[header] = row[index] || '';
    }
  });
  return obj;
}

export default async function handler(req, res) {
  // Get client IP for rate limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                   req.headers['x-real-ip'] || 
                   req.connection?.remoteAddress || 
                   'unknown';

  // Check rate limit
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  // Set CORS headers - whitelist specific origins
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;
  
  // Allow requests without Origin header (same-origin) or from allowed origins
  if (!origin || allowedOrigins.includes(origin)) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const credentials = await getCredentials();
    
    // Authenticate with service account
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    if (req.method === 'GET') {
      // Get all gifts
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:Z`,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.json([]);
      }

      const headers = rows[0];
      const gifts = rows.slice(1).map((row, index) => {
        const record = rowToObject(headers, row);
        const gift = {};
        PUBLIC_FIELDS.forEach(field => {
          if (record[field] !== undefined) gift[field] = record[field];
        });
        // Use row number as ID if no ID column
        if (!gift.id) {
          gift.id = (index + 2).toString(); // +2 because index is 0-based and row 1 is headers
        }
        // Expose only whether the gift is taken, never who took it
        gift.claimed = String(record.claimedBy || '').trim() !== '';
        return gift;
      });

      return res.json(gifts);
    }

    if (req.method === 'PATCH') {
      // Validate request body
      if (!req.body || typeof req.body !== 'object' || !req.body.data) {
        return res.status(400).json({ error: 'Invalid request body' });
      }

      // Update a gift (claim it)
      const { id } = req.query;
      const { data } = req.body;

      // Validate ID
      if (!id || !validateId(id)) {
        return res.status(400).json({ error: 'Invalid or missing ID' });
      }

      // Only the claimer's name comes from the client; it must be non-empty
      // (an empty name would "unclaim" the gift). The date is set server-side.
      if (typeof data.claimedBy !== 'string' || data.claimedBy.trim() === '') {
        return res.status(400).json({ error: 'Name is required' });
      }
      const sanitizedData = {
        claimedBy: sanitizeSheetValue(data.claimedBy),
        claimedDate: new Date().toISOString(),
      };

      // Get all rows to find the one to update
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:Z`,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Sheet is empty' });
      }

      const headers = rows[0];
      const idColumnIndex = headers.indexOf('id');
      
      if (idColumnIndex === -1) {
        return res.status(500).json({ error: 'ID column not found in sheet' });
      }

      // Find the row with matching ID (strict type checking)
      const idString = String(id).trim();
      const rowIndex = rows.findIndex((row, index) => {
        if (index === 0) return false; // Skip header
        return String(row[idColumnIndex] || '').trim() === idString;
      });

      if (rowIndex === -1) {
        return res.status(404).json({ error: 'Gift not found' });
      }

      // Refuse to overwrite an existing claim
      const claimedByIndex = headers.indexOf('claimedBy');
      if (claimedByIndex === -1) {
        return res.status(500).json({ error: 'claimedBy column not found in sheet' });
      }
      if (String(rows[rowIndex][claimedByIndex] || '').trim() !== '') {
        return res.status(409).json({ error: 'This gift has already been claimed' });
      }

      // Build updates only for whitelisted fields
      const updates = [];
      let claimedByRange = null;
      Object.keys(sanitizedData).forEach(key => {
        const colIndex = headers.indexOf(key);
        if (colIndex !== -1) {
          // Convert column index to letter (A, B, C, etc.)
          let colLetter = '';
          let colNum = colIndex;
          while (colNum >= 0) {
            colLetter = String.fromCharCode(65 + (colNum % 26)) + colLetter;
            colNum = Math.floor(colNum / 26) - 1;
          }
          
          const range = `${SHEET_NAME}!${colLetter}${rowIndex + 1}`;
          if (key === 'claimedBy') claimedByRange = range;
          updates.push({
            range,
            values: [[sanitizedData[key]]],
          });
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid columns to update' });
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });

      // Two near-simultaneous claims can both pass the check above. Read the
      // cell back: whoever's name is there won; everyone else gets a 409.
      const verify = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: claimedByRange,
      });
      const storedName = String(verify.data.values?.[0]?.[0] || '').trim();
      if (storedName !== sanitizedData.claimedBy.replace(/^'/, '')) {
        return res.status(409).json({ error: 'This gift has already been claimed' });
      }

      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    // Log full error for debugging (server-side only)
    console.error('Google Sheets API error:', error);
    // Don't expose internal error details to client
    return res.status(500).json({ error: 'Internal server error' });
  }
}

