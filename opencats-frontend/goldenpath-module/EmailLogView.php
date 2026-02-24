<div class="gp-container">
  <div class="gp-header">
    <h2>Email Ingestion Log</h2>
    <div class="gp-filters">
      <select id="gpEmailStatus" onchange="gpFilterEmail()">
        <option value="">All Status</option>
        <option value="processed">Processed</option>
        <option value="unmatched">Unmatched</option>
        <option value="error">Error</option>
      </select>
      <select id="gpEmailDir" onchange="gpFilterEmail()">
        <option value="">All Direction</option>
        <option value="inbound">Inbound</option>
        <option value="outbound">Outbound</option>
      </select>
    </div>
  </div>
  <?php
  $logList = isset($logs['logs']) ? $logs['logs'] : array();
  $total = isset($logs['total']) ? $logs['total'] : 0;
  ?>
  <p style="font-size:10px;color:#838383;margin-bottom:8px"><?php echo $total; ?> total emails ingested</p>
  <table class="gp-table">
    <tr><th>Time</th><th>From</th><th>Subject</th><th>Direction</th><th>Status</th><th>Matched Candidate</th></tr>
    <?php if (count($logList) === 0): ?>
    <tr><td colspan="6" class="gp-empty">No email logs yet. Connect Gmail to start ingesting emails.</td></tr>
    <?php endif; ?>
    <?php foreach ($logList as $log): ?>
    <tr>
      <td><?php echo isset($log['processed_at']) ? date('M j H:i', strtotime($log['processed_at'])) : '—'; ?></td>
      <td><?php echo htmlspecialchars(isset($log['from_addr']) ? $log['from_addr'] : ''); ?></td>
      <td><?php echo htmlspecialchars(isset($log['subject']) ? substr($log['subject'],0,50) : ''); ?></td>
      <td><?php echo isset($log['direction']) ? $log['direction'] : '—'; ?></td>
      <td><span class="gp-status gp-status-<?php echo isset($log['status']) ? $log['status'] : 'pending'; ?>"><?php echo isset($log['status']) ? $log['status'] : '—'; ?></span></td>
      <td><?php echo isset($log['matched_candidate_id']) && $log['matched_candidate_id'] ? '<a href="'.CATSUtility::getIndexName().'?m=candidates&a=show&candidateID='.$log['matched_candidate_id'].'">#'.$log['matched_candidate_id'].'</a>' : '—'; ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
</div>
<script type="text/javascript">
function gpFilterEmail() {
  var s = document.getElementById('gpEmailStatus').value;
  var d = document.getElementById('gpEmailDir').value;
  var url = '<?php echo CATSUtility::getIndexName(); ?>?m=goldenpath&a=emailLog';
  if (s) url += '&status=' + s;
  if (d) url += '&direction=' + d;
  window.location = url;
}
</script>
