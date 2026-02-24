<div class="gp-container">
  <div class="gp-header">
    <h2>Import Candidates from CSV</h2>
  </div>

  <div class="gp-section">
    <h3>Upload CSV File</h3>
    <p style="font-size:11px;color:#838383;margin-bottom:12px">
      CSV must include headers. Supported columns: <strong>first_name, last_name, email, phone, linkedin_url, source, company</strong>
    </p>
    <div style="background:#fff;border:1px solid #d7d7d7;border-radius:8px;padding:20px;max-width:500px">
      <form id="gpImportForm" enctype="multipart/form-data">
        <div style="margin-bottom:12px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">CSV File</label>
          <input type="file" id="gpCsvFile" accept=".csv" style="font-size:11px" />
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Default Source (optional)</label>
          <input type="text" id="gpImportSource" value="csv_import" placeholder="e.g. linkedin, referral" style="width:200px" />
        </div>
        <div style="margin-bottom:12px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Job ID (optional)</label>
          <input type="number" id="gpImportJobId" placeholder="Leave empty for no job" style="width:120px" />
        </div>
        <button type="button" class="gp-btn" onclick="gpStartImport()" id="gpImportBtn">Upload &amp; Import</button>
      </form>
    </div>
  </div>

  <div id="gpImportStatus" style="display:none" class="gp-section">
    <h3>Import Progress</h3>
    <div id="gpImportProgress" class="gp-stats">
      <div class="gp-stat-card">
        <div class="gp-stat-label">Status</div>
        <div class="gp-stat-value" id="gpStatusText">—</div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Total Rows</div>
        <div class="gp-stat-value" id="gpTotalRows">—</div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Imported</div>
        <div class="gp-stat-value" id="gpImported">—</div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Duplicates</div>
        <div class="gp-stat-value" id="gpDuplicates">—</div>
      </div>
      <div class="gp-stat-card">
        <div class="gp-stat-label">Errors</div>
        <div class="gp-stat-value" id="gpErrors">—</div>
      </div>
    </div>
    <div id="gpImportActions" style="display:none;margin-top:12px">
      <a id="gpDownloadResults" class="gp-btn gp-btn-outline" href="#" target="_blank">Download Results CSV</a>
      <button class="gp-btn" onclick="gpResetImport()" style="margin-left:8px">Import Another</button>
    </div>
  </div>

  <div class="gp-section">
    <h3>CSV Template</h3>
    <p style="font-size:11px;color:#838383;margin-bottom:8px">Download a sample CSV to get started:</p>
    <button class="gp-btn gp-btn-outline gp-btn-sm" onclick="gpDownloadTemplate()">Download Template</button>
  </div>
</div>

<script type="text/javascript">
var gpApiBase = '<?php echo CATSUtility::getIndexName(); ?>?m=goldenpath&a=apiProxy&path=';
var gpCurrentJobId = null;

function gpStartImport() {
  var fileInput = document.getElementById('gpCsvFile');
  if (!fileInput.files || !fileInput.files[0]) { alert('Please select a CSV file'); return; }

  var file = fileInput.files[0];
  var source = document.getElementById('gpImportSource').value || 'csv_import';
  var jobId = document.getElementById('gpImportJobId').value || '';

  var btn = document.getElementById('gpImportBtn');
  btn.textContent = 'Uploading...';
  btn.disabled = true;

  // Upload via the proxy — we need multipart, so POST directly to enrichment
  var formData = new FormData();
  formData.append('file', file);
  formData.append('source', source);
  if (jobId) formData.append('job_id', jobId);

  var xhr = new XMLHttpRequest();
  xhr.open('POST', gpApiBase + encodeURIComponent('/v1/candidates/import'));
  xhr.onload = function() {
    btn.textContent = 'Upload & Import';
    btn.disabled = false;
    try {
      var data = JSON.parse(xhr.responseText);
      if (data.error) { alert('Import error: ' + data.error); return; }
      if (data.import_job_id) {
        gpCurrentJobId = data.import_job_id;
        document.getElementById('gpImportStatus').style.display = '';
        document.getElementById('gpTotalRows').textContent = data.total_rows || '—';
        document.getElementById('gpStatusText').textContent = 'Processing...';
        gpPollStatus();
      }
    } catch(e) { alert('Upload failed'); }
  };
  xhr.onerror = function() {
    btn.textContent = 'Upload & Import';
    btn.disabled = false;
    alert('Upload failed — network error');
  };
  xhr.send(formData);
}

function gpPollStatus() {
  if (!gpCurrentJobId) return;
  var xhr = new XMLHttpRequest();
  xhr.open('GET', gpApiBase + encodeURIComponent('/v1/candidates/import/' + gpCurrentJobId + '/status'));
  xhr.onload = function() {
    try {
      var data = JSON.parse(xhr.responseText);
      document.getElementById('gpStatusText').textContent = data.status || '—';
      document.getElementById('gpTotalRows').textContent = data.total_rows || '—';
      document.getElementById('gpImported').textContent = data.imported || '0';
      document.getElementById('gpDuplicates').textContent = data.duplicates || '0';
      document.getElementById('gpErrors').textContent = data.errors || '0';

      if (data.status === 'completed' || data.status === 'failed') {
        document.getElementById('gpImportActions').style.display = '';
        document.getElementById('gpDownloadResults').href = gpApiBase + encodeURIComponent('/v1/candidates/import/' + gpCurrentJobId + '/results.csv');
      } else {
        setTimeout(gpPollStatus, 2000);
      }
    } catch(e) {}
  };
  xhr.send();
}

function gpResetImport() {
  gpCurrentJobId = null;
  document.getElementById('gpImportStatus').style.display = 'none';
  document.getElementById('gpImportActions').style.display = 'none';
  document.getElementById('gpCsvFile').value = '';
}

function gpDownloadTemplate() {
  var csv = 'first_name,last_name,email,phone,linkedin_url,source,company\nJohn,Doe,john@example.com,555-0100,https://linkedin.com/in/johndoe,referral,Acme Corp\nJane,Smith,jane@example.com,555-0200,,linkedin,Widget Inc\n';
  var blob = new Blob([csv], {type: 'text/csv'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'candidate-import-template.csv';
  a.click();
}
</script>
