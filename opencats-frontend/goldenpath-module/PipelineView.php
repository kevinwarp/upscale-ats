<div class="gp-container">
  <div class="gp-header">
    <h2>Hiring Pipeline</h2>
    <div class="gp-filters">
      <select id="gpJobFilter" onchange="gpLoadPipeline()">
        <option value="">All Jobs</option>
      </select>
      <button class="gp-btn gp-btn-sm" onclick="gpLoadPipeline()">Refresh</button>
    </div>
  </div>
  <div id="gpBoard" class="gp-board">
    <div class="gp-loading">Loading pipeline...</div>
  </div>
</div>
<script type="text/javascript">
var gpApiBase = '<?php echo CATSUtility::getIndexName(); ?>?m=goldenpath&a=apiProxy&path=';
var gpStages = <?php echo json_encode($stageList); ?>;

function gpApi(path, cb, method, body) {
  var xhr = new XMLHttpRequest();
  xhr.open(method || 'GET', gpApiBase + encodeURIComponent(path));
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function() { cb(JSON.parse(xhr.responseText)); };
  xhr.onerror = function() { cb({error:'Network error'}); };
  xhr.send(body ? JSON.stringify(body) : null);
}

function gpLoadPipeline() {
  var jobId = document.getElementById('gpJobFilter').value || '0';
  gpApi('/v1/pipeline/' + jobId, function(data) {
    var board = document.getElementById('gpBoard');
    if (data.error) { board.innerHTML = '<div class="gp-empty">Unable to load pipeline data</div>'; return; }
    var stages = data.stages || gpStages || [];
    var candidates = data.candidates || [];
    var html = '';
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      var key = s.stage_key || s;
      var label = s.stage_label || key;
      var cards = [];
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].candidate_stage === key) cards.push(candidates[j]);
      }
      html += '<div class="gp-column"><div class="gp-column-header">' + label + ' <span class="gp-count">' + cards.length + '</span></div>';
      for (var k = 0; k < cards.length; k++) {
        var c = cards[k];
        var name = (c.first_name || '') + ' ' + (c.last_name || '');
        var days = c.days_in_stage || 0;
        var badge = days > 7 ? 'gp-badge-red' : days > 3 ? 'gp-badge-yellow' : 'gp-badge-green';
        html += '<div class="gp-card" onclick="gpShowCandidate(' + c.candidate_id + ')">';
        html += '<div class="gp-card-name">' + name.trim() + '</div>';
        html += '<div class="gp-card-meta">' + (c.email1 || '') + '</div>';
        html += '<span class="gp-card-badge ' + badge + '">' + days + 'd in stage</span>';
        if (c.outreach_sent) html += ' <span class="gp-card-badge gp-badge-purple">Outreach</span>';
        if (c.homework_received) html += ' <span class="gp-card-badge gp-badge-green">HW</span>';
        html += '</div>';
      }
      if (cards.length === 0) html += '<div class="gp-empty" style="padding:20px">No candidates</div>';
      html += '</div>';
    }
    board.innerHTML = html || '<div class="gp-empty">No pipeline data</div>';
  });
}

function gpShowCandidate(id) {
  window.location.href = '<?php echo CATSUtility::getIndexName(); ?>?m=candidates&a=show&candidateID=' + id;
}

gpLoadPipeline();
</script>
