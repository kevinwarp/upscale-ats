<?php
/**
 * Unit tests for CandidateEnrichment model.
 *
 * Uses SQLite in-memory database to simulate MySQL for testing.
 * Run with: php vendor/bin/phpunit tests/CandidateEnrichmentTest.php
 */

require_once(__DIR__ . '/../src/Models/CandidateEnrichment.php');

class CandidateEnrichmentTest extends \PHPUnit\Framework\TestCase
{
    private PDO $db;
    private CandidateEnrichment $model;

    protected function setUp(): void
    {
        // Use SQLite in-memory for testing
        $this->db = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);

        // Create a simplified candidate table
        $this->db->exec("
            CREATE TABLE candidate (
                candidate_id INTEGER PRIMARY KEY AUTOINCREMENT,
                first_name TEXT,
                last_name TEXT,
                email1 TEXT,
                web_site TEXT,
                current_employer TEXT,
                city TEXT,
                state TEXT,
                personal_email TEXT DEFAULT NULL,
                personal_email_status TEXT DEFAULT NULL,
                personal_email_confidence REAL DEFAULT NULL,
                personal_email_provider TEXT DEFAULT NULL,
                personal_email_last_enriched_at TEXT DEFAULT NULL,
                personal_email_enrichment_payload TEXT DEFAULT NULL
            )
        ");

        // Insert test candidate
        $this->db->exec("
            INSERT INTO candidate (first_name, last_name, email1, web_site, current_employer, city, state)
            VALUES ('Alice', 'Smith', 'alice@acme.com', 'https://linkedin.com/in/alice', 'Acme Corp', 'San Francisco', 'CA')
        ");

        $this->model = new CandidateEnrichment($this->db);
    }

    public function testGetCandidateIdentifiers(): void
    {
        $ids = $this->model->getCandidateIdentifiers(1);

        $this->assertEquals('1', $ids['candidate_id']);
        $this->assertEquals('Alice Smith', $ids['full_name']);
        $this->assertEquals('alice@acme.com', $ids['work_email']);
        $this->assertEquals('https://linkedin.com/in/alice', $ids['linkedin_url']);
        $this->assertEquals('Acme Corp', $ids['company']);
        $this->assertEquals('San Francisco, CA', $ids['location']);
    }

    public function testGetCandidateIdentifiersNotFound(): void
    {
        $ids = $this->model->getCandidateIdentifiers(999);
        $this->assertEmpty($ids);
    }

    public function testUpdateEnrichmentResultFound(): void
    {
        $result = $this->model->updateEnrichmentResult(1, [
            'status'            => 'found',
            'personal_email'    => 'alice@gmail.com',
            'confidence'        => 0.85,
            'source'            => 'test',
            'provider_metadata' => ['match_reason' => 'linkedin'],
        ]);

        $this->assertTrue($result['updated']);

        $data = $this->model->getEnrichmentData(1);
        $this->assertEquals('alice@gmail.com', $data['personal_email']);
        $this->assertEquals('unverified', $data['personal_email_status']);
        $this->assertEquals(0.85, (float) $data['personal_email_confidence']);
    }

    public function testNeverOverwriteVerifiedEmail(): void
    {
        // First: set a verified email
        $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'alice@gmail.com',
            'confidence'     => 0.85,
            'source'         => 'test',
        ]);
        $this->model->markAsVerified(1);

        // Try to overwrite — should be blocked
        $result = $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'newemail@gmail.com',
            'confidence'     => 0.95,
            'source'         => 'test',
        ]);

        $this->assertFalse($result['updated']);
        $this->assertStringContainsString('verified', $result['reason']);

        // Email should remain unchanged
        $data = $this->model->getEnrichmentData(1);
        $this->assertEquals('alice@gmail.com', $data['personal_email']);
    }

    public function testOverwriteUnverifiedOnlyIfHigherConfidence(): void
    {
        // Set initial unverified email with confidence 0.80
        $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'alice@gmail.com',
            'confidence'     => 0.80,
            'source'         => 'test',
        ]);

        // Try with lower confidence — should be blocked
        $result = $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'other@gmail.com',
            'confidence'     => 0.50,
            'source'         => 'test',
        ]);
        $this->assertFalse($result['updated']);

        // Try with higher confidence — should succeed
        $result = $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'better@gmail.com',
            'confidence'     => 0.95,
            'source'         => 'test',
        ]);
        $this->assertTrue($result['updated']);

        $data = $this->model->getEnrichmentData(1);
        $this->assertEquals('better@gmail.com', $data['personal_email']);
    }

    public function testForceReplaceOverridesConfidenceCheck(): void
    {
        $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'alice@gmail.com',
            'confidence'     => 0.90,
            'source'         => 'test',
        ]);

        $result = $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'forced@gmail.com',
            'confidence'     => 0.50,
            'source'         => 'test',
        ], true); // forceReplace = true

        $this->assertTrue($result['updated']);
        $data = $this->model->getEnrichmentData(1);
        $this->assertEquals('forced@gmail.com', $data['personal_email']);
    }

    public function testUpdateNoMatch(): void
    {
        $result = $this->model->updateEnrichmentResult(1, [
            'status'         => 'no_match',
            'personal_email' => null,
            'confidence'     => 0,
            'source'         => 'test',
        ]);

        $this->assertTrue($result['updated']);
        $data = $this->model->getEnrichmentData(1);
        $this->assertEquals('no_match', $data['personal_email_status']);
        $this->assertNull($data['personal_email']);
    }

    public function testMarkAsVerified(): void
    {
        $this->model->updateEnrichmentResult(1, [
            'status'         => 'found',
            'personal_email' => 'alice@gmail.com',
            'confidence'     => 0.85,
            'source'         => 'test',
        ]);

        $success = $this->model->markAsVerified(1);
        $this->assertTrue($success);

        $data = $this->model->getEnrichmentData(1);
        $this->assertEquals('verified', $data['personal_email_status']);
    }

    public function testMarkAsVerifiedFailsWithNoEmail(): void
    {
        $success = $this->model->markAsVerified(1);
        $this->assertFalse($success);
    }
}
