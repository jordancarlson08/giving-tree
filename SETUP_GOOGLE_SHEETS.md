# Google Sheets API Setup Instructions

## Prerequisites
- A JSON key for `sub-for-santa-sheets@sub-for-santa-6th-ward.iam.gserviceaccount.com` (Google Cloud console → IAM & Admin → Service Accounts → Keys). Don't keep the key file in the project folder once it's in `.env.local` and Vercel.
- Spreadsheet ID: `1VuSew17HE4-WdRfl3SAZKgjF1wS-Sr6DSKrm2tgRRR4`

## Local Development Setup

1. **Set up environment variable:**
   - Copy the entire contents of the service account key JSON file
   - Paste it as a single-line JSON string in `.env.local`:
   ```
   GOOGLE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...","private_key":"..."}
   ```

2. **For local testing, you'll need to run the API separately or use Vercel CLI:**
   ```bash
   npx vercel dev
   ```

## Vercel Deployment Setup

1. **Go to your Vercel project settings**
2. **Navigate to Environment Variables**
3. **Add a new variable:**
   - **Name:** `GOOGLE_SERVICE_ACCOUNT`
   - **Value:** Paste the entire JSON contents of your service account file as a single line
   - **Environment:** Production, Preview, and Development

4. **Important:** Make sure your Google Sheet is shared with the service account email:
   - Service account email: `sub-for-santa-sheets@sub-for-santa-6th-ward.iam.gserviceaccount.com`
   - Give it **Editor** access

## Testing

The API endpoints are:
- `GET /api/sheets` - Fetch all gifts
- `PATCH /api/sheets?id={giftId}` - Update a gift (claim it)

Example:
```javascript
// Get all gifts
fetch('/api/sheets')

// Claim a gift
fetch('/api/sheets?id=1', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    data: { claimedBy: 'John Doe' } // claimedDate is set by the server
  })
})
```

## Notes

- The API assumes your Google Sheet has headers in the first row
- Column names are case-sensitive
- Required columns: `id`, `item`, `claimedBy`, `claimedDate`. Also used by the page: `shouldWrap` (TRUE/FALSE), `other`, `url`, `previewUrl`, `deliverTo`
- Only those page columns plus a `claimed` true/false flag are returned by `GET`; any other columns (recipient, delivery tracking, claimer names) stay private
- Claiming an already-claimed gift returns `409`
- The sheet name is set to "Sheet1" by default - update `SHEET_NAME` in `api/sheets.js` if different

