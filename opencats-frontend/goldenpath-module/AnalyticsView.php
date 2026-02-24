<div class="gp-container">
  <div class="gp-header">
    <h2>Analytics</h2>
    <div class="gp-filters">
      <select onchange="window.location='<?php echo CATSUtility::getIndexName(); ?>?m=goldenpath&a=analytics&days='+this.value">
        <option value="7" <?php if($days==7) echo 'selected'; ?>>7 days</option>
        <option value="30" <?php if($days==30) echo 'selected'; ?>>30 days</option>
        <option value="90" <?php if($days==90) echo 'selected'; ?>>90 days</option>
      </select>
    </div>
  </div>

  <!-- Pipeline Stats -->
  <div class="gp-section">
    <h3>Pipeline Overview</h3>
    <div class="gp-stats">
      <div class="gp-stat-card">
        <div class="gp-stat-label">Avg Days to Offer</div>
        <div class="gp-stat-value"><?php echo isset($pipeline['avg_days_to_offer']) && $pipeline['avg_days_to_offer'] ? round($pipeline['avg_days_to_offer'],1) : '—'; ?></div>
      </div>
      <?php
      $totalCandidates = 0;
      if (isset($pipeline['stage_distribution'])) {
        foreach ($pipeline['stage_distribution'] as $s) $totalCandidates += $s['count'];
      }
      ?>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Total in Pipeline</div>
        <div class="gp-stat-value"><?php echo $totalCandidates; ?></div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Transitions (<?php echo $days; ?>d)</div>
        <div class="gp-stat-value"><?php echo isset($pipeline['transitions']) ? count($pipeline['transitions']) : 0; ?></div>
      </div>
    </div>
    <?php if (isset($pipeline['stage_distribution']) && count($pipeline['stage_distribution']) > 0): ?>
    <div style="max-width:500px">
      <?php $maxCount = max(array_column($pipeline['stage_distribution'], 'count')); ?>
      <?php foreach ($pipeline['stage_distribution'] as $s): ?>
      <div class="gp-bar-row">
        <div class="gp-bar-label"><?php echo htmlspecialchars($s['stage']); ?></div>
        <div class="gp-bar-track"><div class="gp-bar-fill" style="width:<?php echo $maxCount > 0 ? round($s['count']/$maxCount*100) : 0; ?>%"></div></div>
        <div class="gp-bar-value"><?php echo $s['count']; ?></div>
      </div>
      <?php endforeach; ?>
    </div>
    <?php else: ?>
    <div class="gp-empty">No pipeline data for this period</div>
    <?php endif; ?>
  </div>

  <!-- Feedback Stats -->
  <div class="gp-section">
    <h3>Feedback</h3>
    <div class="gp-stats">
      <?php $comp = isset($feedback['completion']) ? $feedback['completion'] : array(); ?>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Completion Rate</div>
        <div class="gp-stat-value"><?php echo isset($comp['completion_rate']) ? $comp['completion_rate'] . '%' : '—'; ?></div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Total Submitted</div>
        <div class="gp-stat-value"><?php echo isset($comp['total_submitted']) ? $comp['total_submitted'] : 0; ?></div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Total Requested</div>
        <div class="gp-stat-value"><?php echo isset($comp['total_requested']) ? $comp['total_requested'] : 0; ?></div>
      </div>
    </div>
    <?php if (isset($feedback['interviewer_stats']) && count($feedback['interviewer_stats']) > 0): ?>
    <table class="gp-table">
      <tr><th>Interviewer</th><th>Feedback Count</th><th>Avg Response (hrs)</th><th>Avg Score</th></tr>
      <?php foreach ($feedback['interviewer_stats'] as $is): ?>
      <tr>
        <td><?php echo htmlspecialchars($is['interviewer_name']); ?></td>
        <td><?php echo $is['feedback_count']; ?></td>
        <td><?php echo $is['avg_response_hours'] ? $is['avg_response_hours'] . 'h' : '—'; ?></td>
        <td><?php echo $is['avg_score'] ?: '—'; ?></td>
      </tr>
      <?php endforeach; ?>
    </table>
    <?php endif; ?>
  </div>

  <!-- Email Stats -->
  <div class="gp-section">
    <h3>Email Ingestion</h3>
    <div class="gp-stats">
      <?php $es = isset($email['summary']) ? $email['summary'] : array(); ?>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Total Ingested</div>
        <div class="gp-stat-value"><?php echo isset($es['total_ingested']) ? $es['total_ingested'] : 0; ?></div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Match Rate</div>
        <div class="gp-stat-value"><?php echo isset($es['match_rate']) ? $es['match_rate'] . '%' : '—'; ?></div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Inbound / Outbound</div>
        <div class="gp-stat-value"><?php echo (isset($es['inbound']) ? $es['inbound'] : 0) . ' / ' . (isset($es['outbound']) ? $es['outbound'] : 0); ?></div>
      </div>
    </div>
  </div>
</div>
