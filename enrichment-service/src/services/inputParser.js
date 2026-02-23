/**
 * Input parser for quick-add candidate flow.
 * Detects input type and extracts structured data.
 */

/**
 * Detect the type of input and extract key data.
 */
function detectInputType(input) {
  input = input.trim();

  // LinkedIn URL
  if (/https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+/i.test(input)) {
    const url = input.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+/i)[0];
    return { type: 'linkedin_url', url };
  }

  // Email only
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(input)) {
    return { type: 'email', email: input.toLowerCase() };
  }

  // Name + Email (e.g., "Bob Jones bob@example.com" or "Bob Jones, bob@example.com")
  const nameEmailMatch = input.match(/^(.+?)\s*[,<]?\s*([\w.+-]+@[\w-]+\.[\w.]+)\s*>?\s*$/);
  if (nameEmailMatch) {
    return {
      type: 'name_email',
      name: nameEmailMatch[1].trim(),
      email: nameEmailMatch[2].toLowerCase(),
    };
  }

  // Resume text (multi-line, >50 chars)
  if (input.includes('\n') && input.length > 50) {
    return { type: 'resume_text', text: input };
  }

  // Name only (single line, short, no @ symbol)
  if (input.length > 1 && input.length < 100 && !input.includes('@')) {
    return { type: 'name_only', name: input };
  }

  return { type: 'unknown', raw: input };
}

/**
 * Parse a LinkedIn profile URL to extract slug and guess name.
 */
function parseLinkedInUrl(url) {
  const slug = url.match(/linkedin\.com\/in\/([\w-]+)/i)?.[1];
  if (!slug) {
    return { linkedin_url: url, name_guess: null };
  }

  // Strip trailing hash suffix (e.g., "bob-jones-a1b2c3" → "bob-jones")
  const cleanSlug = slug.replace(/-[a-f0-9]{6,}$/i, '');
  const nameGuess = cleanSlug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return {
    linkedin_url: `https://linkedin.com/in/${slug}`,
    name_guess: nameGuess || null,
  };
}

/**
 * Parse raw resume text to extract structured data.
 * Regex-based extraction for MVP.
 */
function parseResumeText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const name = lines[0] || null;
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]?.toLowerCase() || null;
  const phone = text.match(/(\+?1?\s*[-.(]?\d{3}[-.)\s]*\d{3}[-.\s]?\d{4})/)?.[0] || null;

  // Simple title extraction: look for "at" or "@" pattern
  const titleMatch = text.match(/(?:^|\n)\s*(.+?)\s+(?:at|@)\s+(.+?)(?:\n|$)/i);

  return {
    name,
    email,
    phone,
    title: titleMatch?.[1]?.trim() || null,
    company: titleMatch?.[2]?.trim() || null,
    raw_text: text,
  };
}

module.exports = { detectInputType, parseLinkedInUrl, parseResumeText };
