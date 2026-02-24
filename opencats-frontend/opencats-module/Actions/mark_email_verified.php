<?php
/**
 * Action: Mark Personal Email as Verified
 *
 * Called via AJAX from the candidate profile page.
 * Sets personal_email_status = 'verified' for the given candidate.
 */

require_once(__DIR__ . '/../Models/CandidateEnrichment.php');
require_once(__DIR__ . '/../Helpers/EnrichmentConfig.php');

header('Content-Type: application/json');

// --- Permission Check ---
$userId = $_SESSION['user_id'] ?? null;
$userAccessLevel = $_SESSION['access_level'] ?? 0;
$ALLOWED_ACCESS_LEVELS = [400, 500];

if (!$userId || !in_array($userAccessLevel, $ALLOWED_ACCESS_LEVELS)) {
    http_response_code(403);
    echo json_encode(['error' => 'Insufficient permissions']);
    exit;
}

// --- Input ---
$input = json_decode(file_get_contents('php://input'), true);
$candidateId = intval($input['candidate_id'] ?? 0);

if ($candidateId <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid candidate_id']);
    exit;
}

// --- Update ---
$config = EnrichmentConfig::load();

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

$model = new CandidateEnrichment($db);
$success = $model->markAsVerified($candidateId);

echo json_encode([
    'success' => $success,
    'message' => $success ? 'Email marked as verified' : 'No email to verify for this candidate',
]);
