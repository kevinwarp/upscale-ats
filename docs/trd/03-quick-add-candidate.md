# TRD-03: Quick-Add Candidate

## 1. Overview

Implement a fast candidate creation flow that accepts minimal input (LinkedIn URL, name+email, or resume text), auto-detects the input type, creates the candidate record, and triggers enrichment. Also includes a CSV bulk import endpoint and architecture for a Chrome extension.

## 2. Architecture

```
┌───────────────┐   POST quick-add   ┌─────────────────────┐   enrich (async)
│  Quick-Add UI │ ──────────────────► │  enrichment-service  │ ──────────────►
│  (Modal/Box)  │                     │  /v1/candidates/*    │
└───────────────┘                     └─────────────────────┘
                                              │
┌───────────────┐   POST quick-add            │
│  Chrome Ext.  │ ──────────────────►         │
└───────────────┘                       MySQL (shared)
                                              │
┌───────────────┐   POST import        ┌──────────────┐
│  CSV Upload   │ ──────────────────►  │   OpenCATS   │
│  (Form)       │                      └──────────────┘
└───────────────┘
```

## 3. API Endpoints

### 3.1 Quick-Add Candidate

`POST /v1/candidates/quick-add`

Accepts a flexible payload and auto-detects the input type.

**Request:**
```json
{
  "input": "https://linkedin.com/in/bobjones",
  "job_id": 456,
  "source": "linkedin"
}
```

Or:
```json
{
  "input": "Bob Jones bob@example.com",
  "job_id": null,
  "source": null
}
```

Or (resume text):
```json
{
  "input": "Bob Jones\nbob@example.com\n+1-555-0123\nSenior Software Engineer at Acme Corp\n...",
  "job_id": 456,
  "source": "referral"
}
```

**Processing logic:**
1. **Detect input type** (see §4 — Input Parser).
2. **Check duplicates**: Query by extracted email or LinkedIn URL. If duplicate found, return `409 Conflict` with existing `candidate_id`.
3. **Create candidate**: Insert into `candidate` table with extracted fields. Set `candidate_stage = 'applied'`, `source` from request or auto-detected.
4. **Trigger enrichment**: Async call to `POST /v1/enrich/personal-email` (and future enrichment endpoints). Do not wait for enrichment to respond.
5. **Return response**.

**Response (201 Created):**
```json
{
  "candidate_id": 123,
  "name": "Bob Jones",
  "email": "bob@example.com",
  "linkedin_url": "https://linkedin.com/in/bobjones",
  "source": "linkedin",
  "input_type": "linkedin_url",
  "enrichment_status": "pending",
  "profile_url": "/candidates/123"
}
```

**Response (409 Conflict):**
```json
{
  "error": "duplicate_candidate",
  "existing_candidate_id": 42,
  "matched_on": "email",
  "profile_url": "/candidates/42"
}
```

### 3.2 CSV Import

`POST /v1/candidates/import`

Multipart form upload. Returns a job ID for polling.

**Request:** `Content-Type: multipart/form-data`
- `file`: CSV file (max 5MB, max 500 rows)
- `job_id` (optional): Default job association for all rows
- `source` (optional): Default source for all rows

**Response (202 Accepted):**
```json
{
  "import_job_id": "imp_abc123",
  "total_rows": 87,
  "status": "processing",
  "status_url": "/v1/candidates/import/imp_abc123/status"
}
```

### 3.3 Import Status

`GET /v1/candidates/import/:importJobId/status`

**Response:**
```json
{
  "import_job_id": "imp_abc123",
  "status": "completed",
  "total_rows": 87,
  "created": 82,
  "duplicates": 3,
  "errors": 2,
  "enrichment_pending": 82,
  "enrichment_completed": 45,
  "result_csv_url": "/v1/candidates/import/imp_abc123/results.csv",
  "rows": [
    { "row": 1, "status": "created", "candidate_id": 123, "name": "Bob Jones" },
    { "row": 2, "status": "duplicate", "existing_candidate_id": 42, "matched_on": "email" },
    { "row": 3, "status": "error", "error": "Missing first_name and email" }
  ]
}
```

### 3.4 Import Results Download

`GET /v1/candidates/import/:importJobId/results.csv`

Returns the original CSV with appended columns: `import_status`, `candidate_id`, `error_message`.

## 4. Input Parser

New module: `enrichment-service/src/services/inputParser.js`

### 4.1 Detection Logic

```javascript
function detectInputType(input) {
  input = input.trim();

  // LinkedIn URL
  if (/https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+/i.test(input)) {
    return { type: 'linkedin_url', url: extractLinkedInUrl(input) };
  }

  // Email only
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(input)) {
    return { type: 'email', email: input };
  }

  // Name + Email (e.g., "Bob Jones bob@example.com" or "Bob Jones, bob@example.com")
  const nameEmailMatch = input.match(/^(.+?)\s*[,<]?\s*([\w.+-]+@[\w-]+\.[\w.]+)\s*>?\s*$/);
  if (nameEmailMatch) {
    return { type: 'name_email', name: nameEmailMatch[1].trim(), email: nameEmailMatch[2] };
  }

  // Resume text (multi-line, >50 chars)
  if (input.includes('\n') && input.length > 50) {
    return { type: 'resume_text', text: input };
  }

  // Name only (single line, short)
  if (input.length > 1 && input.length < 100 && !input.includes('@')) {
    return { type: 'name_only', name: input };
  }

  return { type: 'unknown', raw: input };
}
```

### 4.2 LinkedIn URL Parser

Extracts slug from URL. For Chrome extension, receives pre-scraped data.

```javascript
function parseLinkedInUrl(url) {
  const slug = url.match(/linkedin\.com\/in\/([\w-]+)/i)?.[1];
  return {
    linkedin_url: `https://linkedin.com/in/${slug}`,
    // Name guess from slug: "bob-jones-a1b2c3" → "Bob Jones"
    name_guess: slug?.replace(/-[a-f0-9]+$/i, '').split('-').map(capitalize).join(' ')
  };
}
```

### 4.3 Resume Text Parser

Regex-based extraction for MVP.

```javascript
function parseResumeText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0]; // Assume first line is name
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || null;
  const phone = text.match(/(\+?1?\s*[-.(]?\d{3}[-.)]\s*\d{3}[-.]?\d{4})/)?.[0] || null;
  // Simple title extraction: look for "at" or "@" pattern
  const titleMatch = text.match(/(?:^|\n)\s*(.+?)\s+(?:at|@)\s+(.+?)(?:\n|$)/i);
  return {
    name,
    email,
    phone,
    title: titleMatch?.[1] || null,
    company: titleMatch?.[2] || null,
    raw_text: text
  };
}
```

## 5. CSV Processing

### 5.1 Implementation

New file: `enrichment-service/src/services/csvImporter.js`

**Processing flow:**
1. Parse CSV using `csv-parse` (streaming for memory efficiency).
2. Validate headers: must include at least `first_name` OR `email`.
3. For each row:
   a. Normalize fields (trim, lowercase email).
   b. Check duplicate (email or LinkedIn URL).
   c. Insert into `candidate` table.
   d. Queue enrichment job.
   e. Record result (created/duplicate/error).
4. Store results in `import_jobs` table.
5. When complete, generate result CSV.

### 5.2 New Table: `import_jobs`

```sql
CREATE TABLE import_jobs (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  rows_processed INT NOT NULL DEFAULT 0,
  rows_created INT NOT NULL DEFAULT 0,
  rows_duplicate INT NOT NULL DEFAULT 0,
  rows_error INT NOT NULL DEFAULT 0,
  status ENUM('processing', 'completed', 'failed') DEFAULT 'processing',
  result_data JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,

  INDEX idx_import_user (user_id),
  INDEX idx_import_status (status)
);
```

### 5.3 Processing Strategy

For MVP: Process synchronously in a background `setTimeout` (non-blocking). The import endpoint returns immediately with the job ID.

For production: Use a job queue (Bull/BullMQ with Redis) to process imports. Each row is a separate job for parallelism and retry.

## 6. Chrome Extension Architecture

### 6.1 Structure

```
chrome-extension/
  manifest.json          # Manifest V3
  background.js          # Service worker
  content.js             # LinkedIn page scraper
  popup.html / popup.js  # Settings UI
  styles.css             # Overlay styles
```

### 6.2 Content Script (LinkedIn Scraper)

Injected on `linkedin.com/in/*` pages. Scrapes:
- Name: `.top-card-layout__title` or similar selector (fragile — LinkedIn changes DOM frequently).
- Headline: `.top-card-layout__headline`
- Location: `.top-card-layout__first-subline`
- Profile photo URL
- Current experience section (first entry)

### 6.3 Communication Flow

1. User clicks extension button on LinkedIn profile page.
2. Content script scrapes DOM → sends data to background service worker.
3. Background worker calls `POST /v1/candidates/quick-add` with scraped data + configured API key.
4. On success: content script shows green checkmark overlay on the page.
5. On duplicate: shows "Already in ATS" badge.

### 6.4 Configuration

Extension popup stores:
- `ats_base_url`: e.g., `https://ats.company.com`
- `api_key`: Bearer token for API auth

Stored in `chrome.storage.sync`.

## 7. Auto-Enrichment Integration

### 7.1 Enrichment Trigger

After candidate creation in quick-add or import, fire and forget:

```javascript
async function triggerEnrichment(candidateId, email) {
  try {
    await fetch(`${config.enrichmentServiceUrl}/v1/enrich/personal-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ candidate_id: candidateId, email })
    });
  } catch (err) {
    logger.warn(`Enrichment trigger failed for candidate ${candidateId}:`, err.message);
    // Non-fatal — candidate is already created
  }
}
```

### 7.2 Enrichment Status on Candidate

Add column to track enrichment state:

```sql
ALTER TABLE candidate
  ADD COLUMN enrichment_status ENUM('none', 'pending', 'completed', 'failed') DEFAULT 'none';
```

## 8. OpenCATS PHP Module Changes

### 8.1 Quick-Add UI

New view template: `opencats-module/src/Views/quick_add_modal.php`

- Floating action button (FAB) on the candidate list page: "+" icon.
- Opens modal with single text input + optional job/source dropdowns.
- On submit: calls `POST /v1/candidates/quick-add` via AJAX.
- Shows confirmation toast with candidate name + link.

### 8.2 Import UI

New view template: `opencats-module/src/Views/csv_import.php`

- Accessible from candidate list page → "Import CSV" button.
- File upload form + job/source defaults.
- After upload: shows live progress table (polls import status endpoint).
- On complete: "Download Results" button.

## 9. Security

- Quick-add endpoint requires Bearer token auth.
- CSV import: validate file type (CSV only), size limit (5MB), row limit (500).
- Chrome extension stores API key in `chrome.storage.sync` (encrypted by Chrome).
- LinkedIn scraping is client-side only (extension DOM access) — no server-side scraping.
- Input sanitization: escape all parsed text before DB insertion to prevent SQL injection / XSS.

## 10. Testing Plan

### Unit Tests
- Input type detection for all variants (LinkedIn URL, email, name+email, resume text, unknown).
- LinkedIn URL slug parsing and name extraction.
- Resume text extraction (name, email, phone, title).
- CSV column validation and row parsing.
- Duplicate detection logic.

### Integration Tests
- Quick-add → candidate created in DB → enrichment triggered (mocked).
- Quick-add with duplicate email → 409 response.
- CSV import → job created → rows processed → status polling → results CSV.
- CSV with mixed valid/invalid/duplicate rows.

### QA Scenarios
- Paste LinkedIn URL with query params and tracking fragments.
- Paste resume with unusual formatting (no email, multiple phone numbers).
- Import CSV with 500 rows (boundary test).
- Import CSV with UTF-8 characters in names.
- Chrome extension on different LinkedIn page layouts (classic vs. new).

## 11. Migration & Rollout

1. Run SQL migration: create `import_jobs` table, add `enrichment_status` column.
2. Deploy enrichment service with new endpoints (`/quick-add`, `/import`).
3. Add quick-add modal and import UI to OpenCATS templates.
4. Internal testing with 10-20 test candidates.
5. Pilot with sourcing team for 1 week.
6. Chrome extension: publish to Chrome Web Store (unlisted) for internal use.
7. GA rollout.
