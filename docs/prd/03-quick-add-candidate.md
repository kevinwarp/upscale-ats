# PRD-03: Quick-Add Candidate

## 1. Problem Statement

Adding a new candidate to OpenCATS today requires filling out a multi-field form with name, email, phone, resume, source, and job association. This process takes 2–5 minutes per candidate and creates friction in three common scenarios:

1. **Sourcing from LinkedIn**: Recruiters find a promising profile, then have to manually copy-paste data into the ATS — often losing context or skipping the step entirely.
2. **Referrals**: An employee sends a name and LinkedIn URL over Slack. The recruiter has to manually create the candidate record and then enrich it.
3. **Bulk imports**: After a career fair or sourcing sprint, recruiters have a CSV/spreadsheet of 50+ candidates and no way to import them without creating each one by hand.

## 2. Goal

Reduce the time to add a candidate to under 10 seconds for single adds and under 1 minute for bulk imports, by accepting minimal input (a LinkedIn URL, a name+email, or pasted resume text) and auto-filling the rest via enrichment.

## 3. Success Metrics

- Single candidate add takes ≤10 seconds (time from click to candidate created).
- ≥80% of quick-added candidates have auto-enriched data (email, title, company) within 30 seconds.
- CSV import of 100 candidates completes in ≤2 minutes.
- ≥60% of new candidates are created via quick-add or import (vs. the legacy full form) within 4 weeks of launch.

## 4. Target Users

- **Recruiter**: Primary user. Sources candidates from LinkedIn, referrals, and job boards.
- **Sourcer**: Dedicated sourcing team member who adds high volumes of candidates.
- **Hiring Manager**: Occasionally adds referral candidates.

## 5. User Stories

### Single Quick-Add
- As a recruiter, I paste a LinkedIn URL into a single text box and click "Add" — the system creates the candidate, scrapes/parses the LinkedIn data, and auto-enriches the profile.
- As a recruiter, I type a name and email into the quick-add box, and the system creates the candidate and triggers enrichment to fill in title, company, phone, and LinkedIn.
- As a recruiter, I paste raw resume text into the quick-add box, and the system extracts name, email, phone, and work history to create the candidate.
- As a recruiter, I see a confirmation toast with the candidate's name and a link to their profile after quick-add.

### Chrome Extension / Bookmarklet
- As a sourcer, I'm browsing LinkedIn and click the Upscale-ATS browser extension — it scrapes the current profile page and sends the data to the ATS, creating a candidate with one click.
- As a sourcer, I see a green checkmark overlay on the LinkedIn profile page confirming the candidate was added.

### Bulk Import
- As a recruiter, I upload a CSV file with columns for name, email, phone, LinkedIn URL, and source — the system creates all candidates and reports success/failure per row.
- As a recruiter, I see a progress bar during import and a summary at the end (e.g., "87 created, 3 duplicates skipped, 10 enrichment pending").
- As a recruiter, I can download a result CSV showing which rows succeeded and which failed (with error reasons).

### Auto-Enrichment
- As a recruiter, when I quick-add a candidate, the system automatically triggers enrichment (using the configured provider) to fill in missing fields — I don't have to manually click "Enrich".

## 6. Requirements

### 6.1 Quick-Add Input Box

- Single text input field on the candidate list page (or a floating action button → modal).
- **Input detection**: The system auto-detects the input type:
  - **LinkedIn URL**: Matches `linkedin.com/in/...` pattern → triggers LinkedIn parse + enrichment.
  - **Email address**: Matches email regex → creates candidate with email, triggers enrichment.
  - **Name + Email**: Matches "First Last <email>" or "First Last, email" pattern → creates with name + email.
  - **Resume text**: Multi-line text (>50 chars, no URL match) → triggers resume parser to extract structured data.
- **Job association** (optional): Dropdown to associate the candidate with a job. Defaults to "No job" if left empty.
- **Source tag** (optional): Dropdown with common sources (LinkedIn, Referral, Job Board, Career Fair, Other). Auto-set to "LinkedIn" if input is a LinkedIn URL.

### 6.2 LinkedIn Parsing

- Extract from LinkedIn profile URL (or scraped HTML from extension):
  - Full name
  - Headline / current title
  - Current company
  - Location
  - Profile photo URL
  - Public profile URL
- **Approach**: For MVP, use a lightweight parser on the browser extension side (scrape the DOM). Server-side LinkedIn scraping is unreliable and against ToS — rely on the extension or user-pasted data.
- Fallback: If parsing fails, create the candidate with just the LinkedIn URL and name (from URL slug), then mark for manual review.

### 6.3 Resume Parsing

- Accept plain text pasted into the input box.
- Extract: name, email, phone, current title, current company, education, skills.
- **Approach**: Regex-based extraction for MVP (name at top, email/phone patterns, section headers for experience/education). Consider an NLP-based parser (e.g., Affinda, Sovren) for v2.
- Store the raw resume text as an attachment on the candidate record.

### 6.4 CSV Bulk Import

- Upload endpoint: `POST /v1/candidates/import`
- **Accepted columns**: `first_name`, `last_name`, `email`, `phone`, `linkedin_url`, `source`, `job_id` (all optional except `first_name` OR `email`).
- **Duplicate detection**: Match on email (exact) or LinkedIn URL (normalized). Duplicates are skipped with a note in the result.
- **Enrichment**: Queue auto-enrichment for each imported candidate. Process asynchronously (don't block the import response).
- **Progress**: Return a job ID immediately; client polls `GET /v1/candidates/import/:jobId/status` for progress.
- **Result file**: Downloadable CSV with original rows + `status` column (created / duplicate / error) + `candidate_id` + `error_message`.
- **Limits**: Max 500 rows per import (configurable). Files larger than 5MB rejected.

### 6.5 Chrome Extension (v1.1 — stretch goal)

- Manifest V3 Chrome extension.
- Detects LinkedIn profile pages (`linkedin.com/in/*`).
- Shows a floating "Add to Upscale-ATS" button on the page.
- On click: scrapes visible profile data from the DOM, sends to `POST /v1/candidates/quick-add`.
- Shows success/failure overlay.
- Config: User sets the ATS base URL and API key in extension settings.

### 6.6 Auto-Enrichment on Create

- After candidate creation (quick-add or import), automatically call the existing `POST /v1/enrich/personal-email` endpoint (or future enrichment endpoints).
- Enrichment runs asynchronously — candidate is created immediately; enriched fields populate within seconds.
- If enrichment fails, candidate is still created — enrichment can be retried manually from the profile.

## 7. Out of Scope (v1)

- LinkedIn API integration (requires LinkedIn Recruiter license and partnership).
- AI-powered resume parsing (use regex for MVP).
- Bulk import from Google Sheets or ATS-to-ATS migration.
- Mobile app for candidate quick-add.
- Deduplication merge UI (skip duplicates only; merging is v2).

## 8. Design Notes

- The quick-add box should feel as fast as a search bar — instant feedback, no page reload.
- For the input detection, show a subtle indicator of what was detected: "LinkedIn URL detected", "Email detected", "Resume text detected".
- The import progress page should show a live-updating table with per-row status.
- Candidate cards created via quick-add should have a "Quick-Added" source badge until source is updated.

## 9. Open Questions

- Should quick-add support drag-and-drop of resume files (PDF/DOCX)? (Recommendation: v2 — start with text paste only for simplicity.)
- Should the Chrome extension support other platforms besides LinkedIn (e.g., GitHub, AngelList)? (Recommendation: LinkedIn only for v1; extensible architecture for future platforms.)
- Should duplicate detection also check name similarity (fuzzy match)? (Recommendation: v2 — exact email/LinkedIn match only for v1 to avoid false positives.)
