<?php
/**
 * CandidateEnrichment Model
 *
 * Handles reading and writing personal email enrichment data
 * for candidate records in OpenCATS.
 */
class CandidateEnrichment
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
     * Get enrichment data for a candidate.
     *
     * @param int $candidateId
     * @return array|null
     */
    public function getEnrichmentData(int $candidateId): ?array
    {
        $stmt = $this->db->prepare("
            SELECT
                candidate_id,
                personal_email,
                personal_email_status,
                personal_email_confidence,
                personal_email_provider,
                personal_email_last_enriched_at,
                personal_email_enrichment_payload
            FROM candidate
            WHERE candidate_id = :id
        ");
        $stmt->execute([':id' => $candidateId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    /**
     * Get candidate identifiers needed for enrichment API call.
     *
     * @param int $candidateId
     * @return array
     */
    public function getCandidateIdentifiers(int $candidateId): array
    {
        $stmt = $this->db->prepare("
            SELECT
                candidate_id,
                CONCAT(first_name, ' ', last_name) AS full_name,
                email1 AS work_email,
                web_site AS linkedin_url,
                current_employer AS company,
                city,
                state
            FROM candidate
            WHERE candidate_id = :id
        ");
        $stmt->execute([':id' => $candidateId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            return [];
        }

        $location = trim(($row['city'] ?? '') . ', ' . ($row['state'] ?? ''), ', ');

        return [
            'candidate_id' => (string) $row['candidate_id'],
            'full_name'    => $row['full_name'] ?? null,
            'linkedin_url' => $row['linkedin_url'] ?? null,
            'company'      => $row['company'] ?? null,
            'work_email'   => $row['work_email'] ?? null,
            'location'     => $location ?: null,
        ];
    }

    /**
     * Update enrichment result for a candidate.
     * Respects write rules: never overwrites verified emails.
     *
     * @param int    $candidateId
     * @param array  $result      Standardized enrichment response
     * @param bool   $forceReplace Force overwrite even if unverified exists
     * @return array ['updated' => bool, 'reason' => string]
     */
    public function updateEnrichmentResult(int $candidateId, array $result, bool $forceReplace = false): array
    {
        $current = $this->getEnrichmentData($candidateId);

        // Rule: Never overwrite verified emails
        if ($current && $current['personal_email_status'] === 'verified') {
            return [
                'updated' => false,
                'reason'  => 'Existing personal email is verified; will not overwrite.',
            ];
        }

        // Rule: If unverified exists, only overwrite if new confidence is higher OR forceReplace
        if (
            $current
            && $current['personal_email'] !== null
            && $current['personal_email_status'] === 'unverified'
            && $result['status'] === 'found'
            && !$forceReplace
        ) {
            $existingConfidence = (float) ($current['personal_email_confidence'] ?? 0);
            $newConfidence = (float) ($result['confidence'] ?? 0);

            if ($newConfidence <= $existingConfidence) {
                return [
                    'updated' => false,
                    'reason'  => 'New confidence is not higher than existing; use force replace to overwrite.',
                ];
            }
        }

        // Apply update
        $status = $result['status'] ?? 'error';
        $email = $result['personal_email'] ?? null;
        $confidence = $result['confidence'] ?? null;
        $provider = $result['source'] ?? 'clay';
        $payload = isset($result['provider_metadata'])
            ? json_encode($result['provider_metadata'])
            : null;

        $stmt = $this->db->prepare("
            UPDATE candidate SET
                personal_email = :email,
                personal_email_status = :status,
                personal_email_confidence = :confidence,
                personal_email_provider = :provider,
                personal_email_last_enriched_at = NOW(),
                personal_email_enrichment_payload = :payload
            WHERE candidate_id = :id
        ");

        $stmt->execute([
            ':email'      => $email,
            ':status'     => $status === 'found' ? 'unverified' : $status,
            ':confidence' => $confidence,
            ':provider'   => $provider,
            ':payload'    => $payload,
            ':id'         => $candidateId,
        ]);

        return [
            'updated' => true,
            'reason'  => "Updated with status: {$status}",
        ];
    }

    /**
     * Mark a candidate's personal email as verified.
     *
     * @param int $candidateId
     * @return bool
     */
    public function markAsVerified(int $candidateId): bool
    {
        $stmt = $this->db->prepare("
            UPDATE candidate
            SET personal_email_status = 'verified'
            WHERE candidate_id = :id
              AND personal_email IS NOT NULL
        ");
        $stmt->execute([':id' => $candidateId]);

        return $stmt->rowCount() > 0;
    }
}
