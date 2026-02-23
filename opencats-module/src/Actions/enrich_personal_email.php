<?php
/**
 * Action: Enrich Personal Email
 *
 * Called via AJAX from the candidate profile page.
 * Validates permissions, calls the enrichment middleware, updates the candidate
 * record, and logs the activity.
 *
 * Request:  POST with candidate_id, force_replace (optional)
 * Response: JSON with enrichment result
 */

// OpenCATS bootstrap (adjust path as needed for your installation)
// require_once(__DIR__ . '/../../../../config.php');
// require_once(__DIR__ . '/../../../../lib/Session.php');

require_once(__DIR__ . '/../Models/CandidateEnrichment.php');
require_once(__DIR__ . '/../Helpers/EnrichmentActivityLog.php');
require_once(__DIR__ . '/../Helpers/EnrichmentConfig.php');

header('Content-Type: application/json');

// --- Permission Check ---
// In a real OpenCATS integration, validate session and check user access level.
// For now, we check for the user info passed via the request or session.
$userId = $_SESSION['user_id'] ?? null;
$userAccessLevel = $_SESSION['access_level'] ?? 0;

// Only Admin (500) and Recruiter (400) roles can enrich
$ALLOWED_ACCESS_LEVELS = [400, 500];

if (!$userId || !in_array($userAccessLevel, $ALLOWED_ACCESS_LEVELS)) {
    http_response_code(403);
    echo json_encode(['error' => 'Insufficient permissions. Admin or Recruiter role required.']);
    exit;
}

// --- Input Validation ---
$input = json_decode(file_get_contents('php://input'), true);
$candidateId = intval($input['candidate_id'] ?? 0);
$forceReplace = (bool) ($input['force_replace'] ?? false);

if ($candidateId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid candidate_id']);
    exit;
}

// --- Load Config ---
$config = EnrichmentConfig::load();

// --- Initialize Dependencies ---
try {
    $db = new PDO(
        "mysql:host={$config['db_host']};port={$config['db_port']};dbname={$config['db_name']}",
        $config['db_user'],
        $config['db_password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

$candidateModel = new CandidateEnrichment($db);
$activityLog = new EnrichmentActivityLog($db);

// --- Get Candidate Identifiers ---
$identifiers = $candidateModel->getCandidateIdentifiers($candidateId);

if (empty($identifiers)) {
    http_response_code(404);
    echo json_encode(['error' => 'Candidate not found']);
    exit;
}

// --- Check Current Enrichment State ---
$currentData = $candidateModel->getEnrichmentData($candidateId);
if ($currentData && $currentData['personal_email_status'] === 'verified' && !$forceReplace) {
    echo json_encode([
        'status'   => 'skipped',
        'reason'   => 'Personal email is already verified',
        'email'    => $currentData['personal_email'],
        'verified' => true,
    ]);
    exit;
}

// --- Call Enrichment Middleware ---
$middlewareUrl = rtrim($config['enrichment_service_url'], '/') . '/v1/enrich/personal-email';

$payload = json_encode($identifiers);

$ch = curl_init($middlewareUrl);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $config['enrichment_token'],
        'X-User-Id: ' . $userId,
    ],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// --- Handle Middleware Response ---
if ($curlError) {
    $activityLog->logEnrichmentAttempt($candidateId, $userId, 'error');
    http_response_code(502);
    echo json_encode([
        'status'  => 'error',
        'message' => 'Enrichment service unavailable',
        'detail'  => $curlError,
    ]);
    exit;
}

if ($httpCode === 429) {
    $responseData = json_decode($response, true);
    echo json_encode([
        'status'  => 'rate_limited',
        'message' => $responseData['error'] ?? 'Rate limit exceeded',
        'next_available' => $responseData['next_available'] ?? null,
    ]);
    exit;
}

if ($httpCode >= 400) {
    $activityLog->logEnrichmentAttempt($candidateId, $userId, 'error');
    http_response_code($httpCode >= 500 ? 502 : $httpCode);
    echo json_encode([
        'status'  => 'error',
        'message' => 'Enrichment service returned an error',
        'http_status' => $httpCode,
    ]);
    exit;
}

$result = json_decode($response, true);

if (!$result || !isset($result['status'])) {
    $activityLog->logEnrichmentAttempt($candidateId, $userId, 'error');
    http_response_code(502);
    echo json_encode(['status' => 'error', 'message' => 'Invalid response from enrichment service']);
    exit;
}

// --- Update Candidate Record ---
$updateResult = $candidateModel->updateEnrichmentResult($candidateId, $result, $forceReplace);

// --- Log Activity ---
$activityLog->logEnrichmentAttempt(
    $candidateId,
    $userId,
    $result['status'],
    (float) ($result['confidence'] ?? 0),
    $result['source'] ?? 'unknown',
    $result['personal_email'] ?? null
);

// --- Return Result ---
echo json_encode([
    'status'         => $result['status'],
    'personal_email' => $result['personal_email'] ?? null,
    'confidence'     => $result['confidence'] ?? 0,
    'source'         => $result['source'] ?? 'clay',
    'updated'        => $updateResult['updated'],
    'update_reason'  => $updateResult['reason'],
    'latency_ms'     => $result['latency_ms'] ?? null,
]);
