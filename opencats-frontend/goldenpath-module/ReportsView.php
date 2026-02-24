<div class="gp-container">
  <div class="gp-header">
    <h2>Candidate Reports</h2>
    <div class="gp-filters">
      <input type="number" id="gpReportCandId" placeholder="Candidate ID" style="width:120px" />
      <button class="gp-btn gp-btn-sm" onclick="gpLoadReport()">Load Report</button>
    </div>
  </div>
  <div id="gpReportContent">
    <div class="gp-empty">
      <div class="gp-empty-icon">&#128203;</div>
      Enter a Candidate ID to view their interview report.<br/>
      Reports are auto-generated when all feedback is submitted.
    </div>
  </div>
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

function gpLoadReport() {
  var id = document.getElementById('gpReportCandId').value;
  if (!id) return;
  var el = document.getElementById('gpReportContent');
  el.innerHTML = '<div class="gp-loading">Loading report...</div>';

  gpApi('/v1/reports/' + id, function(data) {
    if (data.error || !data.report_data) {
      el.innerHTML = '<div class="gp-empty">No report found for candidate #' + id + '</div>';
      return;
    }
    var r = data.report_data;
    var html = '<div class="gp-section"><h3>Report: ' + (r.candidate ? r.candidate.name : 'Candidate #' + id) + '</h3>';
    html += '<div class="gp-stats">';
    html += '<div class="gp-stat-card"><div class="gp-stat-label">Overall Score</div><div class="gp-stat-value">' + (r.scores ? r.scores.average.toFixed(1) : '—') + '</div></div>';
    html += '<div class="gp-stat-card"><div class="gp-stat-label">Technical</div><div class="gp-stat-value">' + (r.scores ? r.scores.technical.toFixed(1) : '—') + '</div></div>';
    html += '<div class="gp-stat-card"><div class="gp-stat-label">Communication</div><div class="gp-stat-value">' + (r.scores ? r.scores.communication.toFixed(1) : '—') + '</div></div>';
    html += '<div class="gp-stat-card"><div class="gp-stat-label">Culture Fit</div><div class="gp-stat-value">' + (r.scores ? r.scores.culture_fit.toFixed(1) : '—') + '</div></div>';
    html += '<div class="gp-stat-card"><div class="gp-stat-label">Problem Solving</div><div class="gp-stat-value">' + (r.scores ? r.scores.problem_solving.toFixed(1) : '—') + '</div></div>';
    html += '<div class="gp-stat-card"><div class="gp-stat-label">Recommendation</div><div class="gp-stat-value" style="font-size:14px">' + (r.recommendation || '—') + '</div></div>';
    html += '</div>';

    if (r.individual_feedback && r.individual_feedback.length > 0) {
      html += '<table class="gp-table"><tr><th>Interviewer</th><th>Scores (T/C/CF/PS)</th><th>Recommendation</th><th>Notes</th></tr>';
      for (var i = 0; i < r.individual_feedback.length; i++) {
        var f = r.individual_feedback[i];
        var scores = f.scores ? (f.scores.technical||0)+'/'+(f.scores.communication||0)+'/'+(f.scores.culture_fit||0)+'/'+(f.scores.problem_solving||0) : '—';
        html += '<tr><td>' + (f.interviewer||'—') + '</td><td>' + scores + '</td><td>' + (f.recommendation||'—') + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + (f.notes||'') + '</td></tr>';
      }
      html += '</table>';
    }
    html += '<p style="font-size:10px;color:#838383;margin-top:12px">Generated: ' + (r.generated_at || '—') + ' | Delivery: ' + (data.delivery_status || 'pending') + '</p>';
    html += '</div>';
    el.innerHTML = html;
  });
}
</script>
