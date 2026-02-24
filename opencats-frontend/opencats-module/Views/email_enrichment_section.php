<?php
/**
 * Email Enrichment Section — Candidate Profile Page
 *
 * Include this template in the OpenCATS candidate profile view.
 * Requires: $candidateId, $enrichmentData (from CandidateEnrichment::getEnrichmentData)
 */

$status = $enrichmentData['personal_email_status'] ?? null;
$email = $enrichmentData['personal_email'] ?? null;
$confidence = $enrichmentData['personal_email_confidence'] ?? null;
$provider = $enrichmentData['personal_email_provider'] ?? null;
$lastEnriched = $enrichmentData['personal_email_last_enriched_at'] ?? null;
$isVerified = ($status === 'verified');

// Calculate cooldown
$cooldownDays = (int) (getenv('CANDIDATE_COOLDOWN_DAYS') ?: 7);
$cooldownActive = false;
$nextAvailable = null;
if ($lastEnriched) {
    $lastEnrichedTs = strtotime($lastEnriched);
    $cooldownEnd = $lastEnrichedTs + ($cooldownDays * 86400);
    if (time() < $cooldownEnd) {
        $cooldownActive = true;
        $nextAvailable = date('Y-m-d', $cooldownEnd);
    }
}
?>

<!-- Email Enrichment Section -->
<div id="enrichment-section" class="enrichment-panel" style="border:1px solid #ddd; border-radius:6px; padding:16px; margin:16px 0; background:#fafbfc;">
  <h3 style="margin:0 0 12px; font-size:15px; color:#333;">
    Email Enrichment
    <span style="font-size:11px; color:#888; font-weight:normal; margin-left:8px;">For professional recruiting outreach only</span>
  </h3>

  <!-- Enrich Button -->
  <div style="margin-bottom:12px;">
    <button
      id="btn-enrich"
      onclick="enrichPersonalEmail(<?= (int)$candidateId ?>)"
      <?= ($cooldownActive && !$isVerified) ? 'disabled' : '' ?>
      style="padding:8px 16px; background:#0066cc; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px;"
    >
      Enrich Personal Email
    </button>

    <?php if ($cooldownActive && !$isVerified): ?>
      <span style="color:#888; font-size:12px; margin-left:8px;">
        Next enrichment available: <?= htmlspecialchars($nextAvailable) ?>
      </span>
    <?php endif; ?>

    <?php if ($isVerified): ?>
      <span style="color:#e67700; font-size:12px; margin-left:8px;">
        ⚠ Email is verified — enriching will require confirmation
      </span>
    <?php endif; ?>
  </div>

  <!-- Status / Spinner -->
  <div id="enrichment-status" style="display:none; margin-bottom:12px;">
    <span id="enrichment-spinner" style="display:none;">⏳ Enriching...</span>
    <span id="enrichment-success" style="display:none; color:#28a745;">✅ Email found</span>
    <span id="enrichment-nomatch" style="display:none; color:#6c757d;">⚪ No match found</span>
    <span id="enrichment-error" style="display:none; color:#dc3545;">
      ❌ Error — <a href="#" onclick="enrichPersonalEmail(<?= (int)$candidateId ?>); return false;">Retry</a>
    </span>
    <span id="enrichment-ratelimit" style="display:none; color:#e67700;">⚠ Rate limit reached</span>
  </div>

  <!-- Result Display -->
  <?php if ($email || $status): ?>
  <table style="font-size:13px; color:#333; border-collapse:collapse; width:100%;">
    <tr>
      <td style="padding:4px 12px 4px 0; font-weight:600; width:140px;">Personal Email:</td>
      <td id="display-email"><?= htmlspecialchars($email ?? '—') ?></td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0; font-weight:600;">Confidence:</td>
      <td id="display-confidence">
        <?= $confidence !== null ? round($confidence * 100) . '%' : '—' ?>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0; font-weight:600;">Provider:</td>
      <td id="display-provider"><?= htmlspecialchars($provider ?? '—') ?></td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0; font-weight:600;">Last Enriched:</td>
      <td id="display-last-enriched"><?= htmlspecialchars($lastEnriched ?? '—') ?></td>
    </tr>
    <tr>
      <td style="padding:4px 12px 4px 0; font-weight:600;">Verified:</td>
      <td>
        <label style="cursor:pointer;">
          <input
            type="checkbox"
            id="chk-verified"
            <?= $isVerified ? 'checked' : '' ?>
            onchange="toggleVerified(<?= (int)$candidateId ?>, this.checked)"
          />
          <?= $isVerified ? 'Yes' : 'No' ?>
        </label>
      </td>
    </tr>
  </table>
  <?php endif; ?>
</div>

<script>
/**
 * Call the Enrich Personal Email backend action via AJAX.
 */
function enrichPersonalEmail(candidateId, forceReplace) {
  const btn = document.getElementById('btn-enrich');
  const statusDiv = document.getElementById('enrichment-status');
  const spinner = document.getElementById('enrichment-spinner');
  const success = document.getElementById('enrichment-success');
  const nomatch = document.getElementById('enrichment-nomatch');
  const errorEl = document.getElementById('enrichment-error');
  const rateLimitEl = document.getElementById('enrichment-ratelimit');

  // Reset states
  statusDiv.style.display = 'block';
  [spinner, success, nomatch, errorEl, rateLimitEl].forEach(el => el.style.display = 'none');
  spinner.style.display = 'inline';
  btn.disabled = true;

  fetch('modules/enrichment/Actions/enrich_personal_email.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate_id: candidateId,
      force_replace: forceReplace || false,
    }),
  })
  .then(res => res.json())
  .then(data => {
    spinner.style.display = 'none';

    if (data.status === 'found') {
      success.style.display = 'inline';
      updateDisplayFields(data);
    } else if (data.status === 'no_match') {
      nomatch.style.display = 'inline';
    } else if (data.status === 'rate_limited') {
      rateLimitEl.style.display = 'inline';
      if (data.next_available) {
        rateLimitEl.textContent = '⚠ Rate limit — next available: ' + data.next_available;
      }
    } else if (data.status === 'skipped') {
      success.style.display = 'inline';
      success.textContent = '✅ Already verified: ' + data.email;
    } else {
      errorEl.style.display = 'inline';
    }

    btn.disabled = false;
  })
  .catch(() => {
    spinner.style.display = 'none';
    errorEl.style.display = 'inline';
    btn.disabled = false;
  });
}

/**
 * Update the display fields after a successful enrichment.
 */
function updateDisplayFields(data) {
  const fields = {
    'display-email': data.personal_email || '—',
    'display-confidence': data.confidence ? Math.round(data.confidence * 100) + '%' : '—',
    'display-provider': data.source || '—',
    'display-last-enriched': new Date().toLocaleString(),
  };

  for (const [id, value] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
}

/**
 * Toggle the verified status of the personal email.
 */
function toggleVerified(candidateId, isChecked) {
  if (isChecked) {
    fetch('modules/enrichment/Actions/mark_email_verified.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: candidateId }),
    })
    .then(res => res.json())
    .then(data => {
      if (!data.success) {
        alert(data.message || 'Could not verify email');
        document.getElementById('chk-verified').checked = false;
      }
    })
    .catch(() => {
      alert('Error verifying email');
      document.getElementById('chk-verified').checked = false;
    });
  }
}
</script>
