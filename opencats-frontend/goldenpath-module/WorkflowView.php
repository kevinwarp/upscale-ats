<div class="gp-container">
  <div class="gp-header">
    <h2>Workflow Events</h2>
    <div class="gp-filters">
      <select id="gpWfType" onchange="gpLoadWorkflow()">
        <option value="">All Types</option>
        <option value="stage_transition">Stage Transition</option>
        <option value="report_generated">Report Generated</option>
        <option value="outreach_detected">Outreach Detected</option>
        <option value="homework_received">Homework Received</option>
      </select>
      <button class="gp-btn gp-btn-sm" onclick="gpLoadWorkflow()">Refresh</button>
    </div>
  </div>
  <table class="gp-table" id="gpWfTable">
    <tr><th>Time</th><th>Type</th><th>Candidate</th><th>Source</th><th>Details</th></tr>
    <tr><td colspan="5" class="gp-loading">Loading events...</td></tr>
  </table>
</div>
<script type="text/javascript">
var gpApiBase = '<?php echo CATSUtility::getIndexName(); ?>?m=goldenpath&a=apiProxy&path=';

function gpApi(path, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', gpApiBase + encodeURIComponent(path));
  xhr.onload = function() { cb(JSON.parse(xhr.responseText)); };
  xhr.onerror = function() { cb({error:'Network error'}); };
  xhr.send();
}

function gpLoadWorkflow() {
  var type = document.getElementById('gpWfType').value;
  var path = '/v1/pipeline/stages';
  // Query workflow events from DB via proxy
  gpApi('/v1/analytics/pipeline?days=90', function(data) {
    var table = document.getElementById('gpWfTable');
    var transitions = data.transitions || [];
    var html = '<tr><th>From Stage</th><th>To Stage</th><th>Count</th><th>Direction</th><th>Type</th></tr>';
    if (transitions.length === 0) {
      html += '<tr><td colspan="5" class="gp-empty">No workflow events found</td></tr>';
    }
    for (var i = 0; i < transitions.length; i++) {
      var t = transitions[i];
      var isReject = t.to_stage === 'rejected';
      html += '<tr>';
      html += '<td>' + (t.from_stage || '—') + '</td>';
      html += '<td><span class="gp-status ' + (isReject ? 'gp-status-error' : 'gp-status-processed') + '">' + t.to_stage + '</span></td>';
      html += '<td>' + t.count + '</td>';
      html += '<td>' + (isReject ? 'Rejected' : 'Advanced') + '</td>';
      html += '<td>Stage Transition</td>';
      html += '</tr>';
    }
    table.innerHTML = html;
  });
}
gpLoadWorkflow();
</script>
