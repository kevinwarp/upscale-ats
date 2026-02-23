<?php
/**
 * EnrichmentActivityLog
 *
 * Logs enrichment attempts to the OpenCATS activity table
 * for audit and provenance tracking.
 */
class EnrichmentActivityLog
{
    private $db;

    /**
     * @param PDO $db Database connection
     */
    public function __construct(PDO $db)
    {
        $this->db = $db;
    }

    /**
     * Log an enrichment attempt.
     *
     * @param int    $candidateId
     * @param int    $userId       The OpenCATS user who triggered the enrichment
     * @param string $status       found | no_match | error
     * @param float  $confidence
     * @param string $provider
     * @param string $email        The found email (null if not found)
     * @return void
     */
    public function logEnrichmentAttempt(
        int $candidateId,
        int $userId,
        string $status,
        float $confidence = 0.0,
        string $provider = 'clay',
        ?string $email = null
    ): void {
        $emailDisplay = $email ? $this->maskEmail($email) : 'N/A';
        $confidencePct = round($confidence * 100);

        $notes = sprintf(
            'Personal email enriched via %s — result: %s — email: %s — confidence: %d%% — timestamp: %s',
            $provider,
            $status,
            $emailDisplay,
            $confidencePct,
            date('Y-m-d H:i:s')
        );

        // OpenCATS activity log table structure
        $stmt = $this->db->prepare("
            INSERT INTO activity (
                data_item_id,
                data_item_type,
                entered_by,
                type,
                notes,
                date_created
            ) VALUES (
                :candidate_id,
                200,
                :user_id,
                1200,
                :notes,
                NOW()
            )
        ");

        $stmt->execute([
            ':candidate_id' => $candidateId,
            ':user_id'      => $userId,
            ':notes'        => $notes,
        ]);
    }

    /**
     * Mask email for display in logs (show first 2 chars + domain).
     *
     * @param string $email
     * @return string
     */
    private function maskEmail(string $email): string
    {
        $parts = explode('@', $email);
        if (count($parts) !== 2) {
            return '***';
        }
        $local = substr($parts[0], 0, 2) . '***';
        return $local . '@' . $parts[1];
    }
}
