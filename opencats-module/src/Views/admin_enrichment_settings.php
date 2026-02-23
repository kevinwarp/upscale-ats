<?php
/**
 * Admin Enrichment Settings Page
 *
 * Allows administrators to configure enrichment policy.
 * API credentials are managed via environment variables, NOT stored in the DB.
 */

require_once(__DIR__ . '/../Helpers/EnrichmentConfig.php');

// --- Permission Check ---
$userAccessLevel = $_SESSION['access_level'] ?? 0;
if ($userAccessLevel < 500) {
    http_response_code(403);
    echo '<p>Access denied. Admin role required.</p>';
    return;
}

$config = EnrichmentConfig::load();
$missingSecrets = EnrichmentConfig::validateRequired();

// Handle form submission
$saved = false;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['save_settings'])) {
    // These settings could be saved to a config table or file
    // For MVP, they are read from env vars only
    $saved = true;
}
?>

<div style="max-width:640px; padding:20px;">
  <h2>Email Enrichment Settings</h2>

  <?php if (!empty($missingSecrets)): ?>
    <div style="background:#fff3cd; border:1px solid #ffc107; border-radius:4px; padding:12px; margin-bottom:16px;">
      <strong>⚠ Missing Configuration:</strong>
      <ul style="margin:8px 0 0;">
        <?php foreach ($missingSecrets as $key): ?>
          <li><code><?= htmlspecialchars($key) ?></code> — set this environment variable before using enrichment.</li>
        <?php endforeach; ?>
      </ul>
    </div>
  <?php endif; ?>

  <?php if ($saved): ?>
    <div style="background:#d4edda; border:1px solid #28a745; border-radius:4px; padding:12px; margin-bottom:16px;">
      ✅ Settings saved.
    </div>
  <?php endif; ?>

  <!-- API Credentials Status -->
  <fieldset style="border:1px solid #ddd; border-radius:4px; padding:16px; margin-bottom:16px;">
    <legend style="font-weight:600;">API Credentials</legend>
    <p style="font-size:13px; color:#666;">
      API keys are managed via environment variables for security. They are <strong>never stored in the database</strong>.
    </p>
    <table style="font-size:13px;">
      <tr>
        <td style="padding:4px 12px 4px 0; font-weight:600;">Enrichment Token:</td>
        <td><?= !empty($config['enrichment_token']) ? '✅ Configured' : '❌ Not set' ?></td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0; font-weight:600;">Service URL:</td>
        <td><?= htmlspecialchars($config['enrichment_service_url']) ?></td>
      </tr>
    </table>
  </fieldset>

  <!-- Enrichment Policy -->
  <fieldset style="border:1px solid #ddd; border-radius:4px; padding:16px; margin-bottom:16px;">
    <legend style="font-weight:600;">Enrichment Policy</legend>
    <form method="POST">
      <table style="font-size:13px;">
        <tr>
          <td style="padding:6px 12px 6px 0; font-weight:600;">Enrichment Enabled:</td>
          <td>
            <span style="color:<?= $config['enrichment_enabled'] ? '#28a745' : '#dc3545' ?>; font-weight:600;">
              <?= $config['enrichment_enabled'] ? 'Yes' : 'No' ?>
            </span>
            <span style="color:#888; font-size:11px;">(set ENRICHMENT_ENABLED env var)</span>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0; font-weight:600;">Per-User Daily Limit:</td>
          <td><?= $config['per_user_daily_limit'] ?> enrichments/day</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0; font-weight:600;">Global Daily Cap:</td>
          <td><?= $config['global_daily_cap'] ?> enrichments/day</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0; font-weight:600;">Candidate Cooldown:</td>
          <td><?= $config['cooldown_days'] ?> days</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0; font-weight:600;">Daily Cost Cap:</td>
          <td>$<?= number_format($config['daily_cost_cap_usd'], 2) ?> USD</td>
        </tr>
      </table>
      <p style="font-size:12px; color:#888; margin-top:12px;">
        All policy values are configured via environment variables. Update your <code>.env</code> file and restart the service to apply changes.
      </p>
    </form>
  </fieldset>

  <!-- Audit Information -->
  <fieldset style="border:1px solid #ddd; border-radius:4px; padding:16px;">
    <legend style="font-weight:600;">Audit & Compliance</legend>
    <p style="font-size:13px; color:#666;">
      All enrichment requests are logged in the Activity Log with: user, candidate, timestamp, result, and confidence score.
      Review candidate activity logs for full enrichment history.
    </p>
    <p style="font-size:12px; color:#888; background:#f8f9fa; padding:8px; border-radius:4px;">
      <strong>Policy Notice:</strong> Personal email enrichment is for professional recruiting outreach only.
      Adhere to applicable privacy laws and respect opt-out requests.
    </p>
  </fieldset>
</div>
