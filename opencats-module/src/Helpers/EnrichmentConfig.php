<?php
/**
 * EnrichmentConfig
 *
 * Centralized configuration loader for enrichment module.
 * Reads from environment variables (preferred) or falls back to defaults.
 * API keys are NEVER stored in the database.
 */
class EnrichmentConfig
{
    /**
     * Load enrichment configuration.
     *
     * @return array
     */
    public static function load(): array
    {
        return [
            // Database
            'db_host'     => getenv('DB_HOST') ?: 'localhost',
            'db_port'     => getenv('DB_PORT') ?: '3306',
            'db_name'     => getenv('DB_NAME') ?: 'opencats',
            'db_user'     => getenv('DB_USER') ?: 'opencats',
            'db_password' => getenv('DB_PASSWORD') ?: '',

            // Enrichment Service
            'enrichment_service_url' => getenv('ENRICHMENT_SERVICE_URL') ?: 'http://localhost:3001',
            'enrichment_token'       => getenv('ATS_ENRICHMENT_TOKEN') ?: '',

            // Policy
            'enrichment_enabled'     => filter_var(getenv('ENRICHMENT_ENABLED') ?: 'true', FILTER_VALIDATE_BOOLEAN),
            'per_user_daily_limit'   => (int) (getenv('RATE_LIMIT_PER_USER_PER_DAY') ?: 60),
            'cooldown_days'          => (int) (getenv('CANDIDATE_COOLDOWN_DAYS') ?: 7),
            'global_daily_cap'       => (int) (getenv('RATE_LIMIT_GLOBAL_PER_DAY') ?: 500),
            'daily_cost_cap_usd'     => (float) (getenv('DAILY_COST_CAP_USD') ?: 50),
        ];
    }

    /**
     * Validate that required secrets are configured.
     *
     * @return array List of missing config keys (empty if all present)
     */
    public static function validateRequired(): array
    {
        $config = self::load();
        $missing = [];

        if (empty($config['enrichment_token'])) {
            $missing[] = 'ATS_ENRICHMENT_TOKEN';
        }
        if (empty($config['enrichment_service_url'])) {
            $missing[] = 'ENRICHMENT_SERVICE_URL';
        }

        return $missing;
    }
}
