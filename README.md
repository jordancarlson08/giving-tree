# Giving Tree

The Grove Park 6th Ward Sub-for-Santa gift registry. Ward members browse the gifts that are still needed, claim one by entering their name, and get delivery instructions they can save to their calendar or clipboard.

Live site: https://giving-tree-6th-ward.vercel.app (Vercel project `giving-tree`). The old address, sub-for-santa-6th-ward.vercel.app, redirects there.

## How it works

- **Data lives in a Google Sheet** ("Giving Tree 2026 DB"). Organizers add gifts there, and the site reads and writes it through a Google service account.
- **`api/sheets.js`** is a Vercel serverless function and the only thing that talks to Google:
  - `GET /api/sheets` returns the gifts, but only the columns the page needs plus a `claimed` true/false flag. Recipients, claimer names and any other columns stay private.
  - `PATCH /api/sheets?id=<id>` with `{"data": {"claimedBy": "Name"}}` claims a gift. The server sets `claimedDate`, refuses an empty name, and returns `409` if the gift is already claimed (including when two people claim at the same moment).
  - Basic protections: allowed origins for CORS, a per-IP rate limit (20 requests a minute per server instance), and neutralizing values that start with a spreadsheet formula character.
- **`src/App.jsx`** is the React page. It hides claimed gifts and remembers in the visitor's browser which gifts they claimed and the name they used. After a claim it shows delivery instructions with "Add to Calendar" (an `.ics` file) and "Copy Details" buttons.

## The spreadsheet

The first tab must be named `Sheet1` (or change `SHEET_NAME` in `api/sheets.js`), with headers in row 1. Column order doesn't matter, but names are case-sensitive.

| Column | Required | Shown publicly | Notes |
| --- | --- | --- | --- |
| `id` | yes | yes | Unique per row; letters, numbers, `-` and `_` only |
| `item` | yes | yes | Gift name |
| `claimedBy` | yes | no (only as `claimed`) | Leave blank; filled in when someone claims the gift |
| `claimedDate` | yes | no | Leave blank; set by the server |
| `shouldWrap` | no | yes | `TRUE`/`FALSE`, `yes`/`no` (also `y`/`n`, `x`, `1`/`0`). Blank shows no badge |
| `deliverTo` | no | yes | Where to drop off the gift |
| `other` | no | yes | Size, color, other notes |
| `url` | no | yes | Product link |
| `previewUrl` | no | yes | Image URL |

Any other columns (for example `receipient`, `Delivered`) are fine and never leave the server. `sample-gifts.json` has example rows.

The sheet must be shared, as an **Editor**, with the service account `sub-for-santa-sheets@sub-for-santa-6th-ward.iam.gserviceaccount.com`. The service account needs no IAM roles in Google Cloud. (Its `sub-for-santa` names come from the Google Cloud project, whose ID can't be changed.)

## Local development

Requires **Node 22+**, because `googleapis` needs it.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Put the service account key in `.env.local` as one line. This file is gitignored and excluded from Vercel uploads:
   ```
   GOOGLE_SERVICE_ACCOUNT={"type":"service_account","client_email":"...","private_key":"..."}
   ```
3. Run the site and the API together with the Vercel CLI, then open http://localhost:3000:
   ```bash
   npm run dev:vercel
   ```
   `npm run dev` starts only the Vite front end (port 5173), so the API calls will fail.

Local development uses the real spreadsheet, so claims made locally are real claims. Clear the `claimedBy`/`claimedDate` cells afterwards.

## Deployment

The `giving-tree` Vercel project is connected to this GitHub repo:

- **Merging into `main` deploys production** automatically.
- Every other branch you push gets a preview deployment, linked from its pull request. Previews are behind Vercel login; check their API with `vercel curl /api/sheets --deployment <deployment id>`.

To use the Vercel CLI from this folder (for `vercel dev`, `vercel env`, or a manual `vercel --prod`), link it to the project once:

```bash
vercel link --project giving-tree
```

Environment variables on the `giving-tree` project:

- `GOOGLE_SERVICE_ACCOUNT`: the service account key JSON. It's stored as **Sensitive**, so it can't be viewed in the dashboard or pulled; set it for Production and Preview only.
- `ALLOWED_ORIGINS`: comma-separated extra origins allowed to call the API (set to `https://giving-tree-6th-ward.vercel.app`). `localhost:3000` and the deployment's own URL are always allowed.

## New season checklist

1. Create a new sheet with the columns above, and share it with the service account as an Editor. Unshare or delete last year's sheet.
2. Update `SPREADSHEET_ID` in `api/sheets.js`.
3. Update `DELIVER_BY` at the top of `src/App.jsx`. It drives the date in the instructions, the copied details and the calendar invite.
4. Rotate the service account key: in Google Cloud console go to **IAM & Admin → Service Accounts → sub-for-santa-sheets → Keys**, create a new JSON key and delete the old one. Then update `.env.local` and the Sensitive `GOOGLE_SERVICE_ACCOUNT` variable in Vercel, and delete the downloaded key file.
5. Run `npm audit` and update dependencies.
6. Merge into `main` to deploy, then make one test claim on the live site and clear it in the sheet.

## Tech stack

React 18, Vite 6, the Google Sheets API (`googleapis`), and Vercel serverless functions.
