<?php
include_once(LEGACY_ROOT . '/lib/TemplateUtility.php');
include_once(LEGACY_ROOT . '/lib/Session.php');

class GoldenPathUI extends UserInterface
{
    private $_enrichmentBaseUrl;

    public function __construct()
    {
        parent::__construct();
        $this->_authenticationRequired = true;
        $this->_moduleDirectory = 'goldenpath';
        $this->_moduleName = 'goldenpath';
        $this->_moduleTabText = 'Golden Path';
        $this->_subTabs = array(
            'Pipeline'  => CATSUtility::getIndexName() . '?m=goldenpath&a=pipeline',
            'Analytics' => CATSUtility::getIndexName() . '?m=goldenpath&a=analytics',
            'Workflow'  => CATSUtility::getIndexName() . '?m=goldenpath&a=workflow',
            'Email Log' => CATSUtility::getIndexName() . '?m=goldenpath&a=emailLog',
            'Reports'   => CATSUtility::getIndexName() . '?m=goldenpath&a=reports',
            'Import'    => CATSUtility::getIndexName() . '?m=goldenpath&a=import',
        );
        $this->_enrichmentBaseUrl = getenv('ENRICHMENT_SERVICE_URL') ?: 'https://upscale-ats-enrichment-7kn2y4cpsa-uc.a.run.app';
    }

    public function handleRequest()
    {
        $action = $this->getAction();
        switch ($action)
        {
            case 'pipeline':  $this->showPipeline();  break;
            case 'analytics': $this->showAnalytics(); break;
            case 'workflow':  $this->showWorkflow();  break;
            case 'emailLog':  $this->showEmailLog();  break;
            case 'reports':   $this->showReports();   break;
            case 'import':    $this->showImport();    break;
            case 'apiProxy':  $this->apiProxy();      break;
            default:          $this->showPipeline();  break;
        }
    }

    public function apiCall($path, $method = 'GET', $body = null)
    {
        $url = $this->_enrichmentBaseUrl . $path;
        $token = getenv('ENRICHMENT_TOKEN') ?: '';

        $opts = array(
            'http' => array(
                'method'  => $method,
                'header'  => "Content-Type: application/json\r\nAuthorization: Bearer " . $token . "\r\n",
                'timeout' => 10,
                'ignore_errors' => true,
            )
        );
        if ($body) {
            $opts['http']['content'] = json_encode($body);
        }
        $ctx = stream_context_create($opts);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) return array('error' => 'Service unavailable');
        return json_decode($raw, true) ?: array();
    }

    private function showPipeline()
    {
        $stages = $this->apiCall('/v1/pipeline/stages');
        $stageList = isset($stages['stages']) ? $stages['stages'] : array();

        TemplateUtility::printHeader('Golden Path - Pipeline', array('modules/goldenpath/goldenpath.css'));
        TemplateUtility::printHeaderBlock();
        TemplateUtility::printTabs($this, 'Pipeline');
        include(LEGACY_ROOT . '/modules/goldenpath/PipelineView.php');
        TemplateUtility::printFooter();
    }

    private function showAnalytics()
    {
        $days = isset($_GET['days']) ? intval($_GET['days']) : 30;
        $pipeline = $this->apiCall('/v1/analytics/pipeline?days=' . $days);
        $feedback = $this->apiCall('/v1/analytics/feedback?days=' . $days);
        $email    = $this->apiCall('/v1/analytics/email?days=' . $days);

        TemplateUtility::printHeader('Golden Path - Analytics', array('modules/goldenpath/goldenpath.css'));
        TemplateUtility::printHeaderBlock();
        TemplateUtility::printTabs($this, 'Analytics');
        include(LEGACY_ROOT . '/modules/goldenpath/AnalyticsView.php');
        TemplateUtility::printFooter();
    }

    private function showWorkflow()
    {
        TemplateUtility::printHeader('Golden Path - Workflow Events', array('modules/goldenpath/goldenpath.css'));
        TemplateUtility::printHeaderBlock();
        TemplateUtility::printTabs($this, 'Workflow');
        include(LEGACY_ROOT . '/modules/goldenpath/WorkflowView.php');
        TemplateUtility::printFooter();
    }

    private function showEmailLog()
    {
        $logs = $this->apiCall('/v1/email/logs?limit=100');

        TemplateUtility::printHeader('Golden Path - Email Log', array('modules/goldenpath/goldenpath.css'));
        TemplateUtility::printHeaderBlock();
        TemplateUtility::printTabs($this, 'Email Log');
        include(LEGACY_ROOT . '/modules/goldenpath/EmailLogView.php');
        TemplateUtility::printFooter();
    }

    private function showReports()
    {
        TemplateUtility::printHeader('Golden Path - Reports', array('modules/goldenpath/goldenpath.css'));
        TemplateUtility::printHeaderBlock();
        TemplateUtility::printTabs($this, 'Reports');
        include(LEGACY_ROOT . '/modules/goldenpath/ReportsView.php');
        TemplateUtility::printFooter();
    }

    private function showImport()
    {
        TemplateUtility::printHeader('Golden Path - Import', array('modules/goldenpath/goldenpath.css'));
        TemplateUtility::printHeaderBlock();
        TemplateUtility::printTabs($this, 'Import');
        include(LEGACY_ROOT . '/modules/goldenpath/ImportView.php');
        TemplateUtility::printFooter();
    }

    private function apiProxy()
    {
        header('Content-Type: application/json');
        $path = isset($_GET['path']) ? $_GET['path'] : '';
        if (!$path) { echo json_encode(array('error' => 'path required')); return; }

        $method = $_SERVER['REQUEST_METHOD'];
        $body = null;
        if ($method === 'POST' || $method === 'PUT' || $method === 'PATCH') {
            $body = json_decode(file_get_contents('php://input'), true);
        }
        $result = $this->apiCall($path, $method, $body);
        echo json_encode($result);
        exit;
    }
}
?>
