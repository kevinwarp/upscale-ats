<?php
/*
 * OpenCATS Configuration - Auto-configured for Cloud Run
 */
error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED);
ini_set('display_errors', 0);

/* License key. */
define('LICENSE_KEY','3163GQ-54ISGW-14E4SHD-ES9ICL-X02DTG-GYRSQ6');

/* Legacy root. */
if (!defined('LEGACY_ROOT')) {
    define('LEGACY_ROOT', '.');
}

/* Database configuration. */
define('DATABASE_USER', getenv('DATABASE_USER') ?: 'opencats');
define('DATABASE_PASS', getenv('DATABASE_PASS') ?: '');
define('DATABASE_HOST', getenv('DATABASE_HOST') ?: 'localhost');
define('DATABASE_NAME', getenv('DATABASE_NAME') ?: 'opencats');

/* Authentication Configuration */
define('AUTH_MODE', 'sql');

/* Parsing */
define('PARSING_ENABLED', false);

/* SSL */
define('SSL_ENABLED', false);

/* Text parser paths */
define('ANTIWORD_PATH', '/usr/bin/antiword');
define('ANTIWORD_MAP', '8859-1.txt');
define('PDFTOTEXT_PATH', '/usr/bin/pdftotext');
define('HTML2TEXT_PATH', '/usr/bin/html2text');
define('UNRTF_PATH', '/usr/bin/unrtf');

/* Temporary directory */
define('CATS_TEMP_DIR', './temp');

/* Hostname lookup */
define('ENABLE_HOSTNAME_LOOKUP', false);

/* Sphinx search */
define('ENABLE_SPHINX', false);
define('SPHINX_API', './lib/sphinx/sphinxapi.php');
define('SPHINX_HOST', 'localhost');
define('SPHINX_PORT', 3312);
define('SPHINX_INDEX', 'cats catsdelta');

/* Pager settings */
define('CONTACTS_PER_PAGE',      15);
define('CANDIDATES_PER_PAGE',    15);
define('CLIENTS_PER_PAGE',       15);
define('LOGIN_ENTRIES_PER_PAGE', 15);

/* Display settings */
define('LAST_NAME_MAXLEN', 6);
define('SEARCH_EXCERPT_LENGTH', 256);
define('MRU_MAX_ITEMS', 5);
define('MRU_ITEM_LENGTH', 20);
define('RECENT_SEARCH_MAX_ITEMS', 5);

/* Encoding */
define('HTML_ENCODING', 'UTF-8');
define('AJAX_ENCODING', 'UTF-8');
define('SQL_CHARACTER_SET', 'utf8');

/* CSV BOM */
define('INSERT_BOM_CSV_LENGTH', '3');
define('INSERT_BOM_CSV_1', '239');
define('INSERT_BOM_CSV_2', '187');
define('INSERT_BOM_CSV_3', '191');
define('INSERT_BOM_CSV_4', '');

/* Path to modules. */
define('MODULES_PATH', './modules/');

/* Session */
define('CATS_SESSION_NAME', 'CATS');

/* Email subjects */
define('CAREERS_CANDIDATEAPPLY_SUBJECT', 'Thank You for Your Application');
define('CAREERS_OWNERAPPLY_SUBJECT', 'CATS - A Candidate Has Applied to Your Job Order');
define('CANDIDATE_STATUSCHANGE_SUBJECT', 'Job Application Status Change');

/* Password recovery */
define('FORGOT_PASSWORD_FROM_NAME', 'CATS');
define('FORGOT_PASSWORD_SUBJECT',   'CATS - Password Retrieval Request');
define('FORGOT_PASSWORD_BODY',      'You recently requested that your OpenCATS password be sent to you. Your current password is %s.');

/* Demo mode */
define('ENABLE_DEMO_MODE', false);

/* Timezone offset */
define('OFFSET_GMT', 0);

/* Single session */
define('ENABLE_SINGLE_SESSION', false);

/* Tester config */
define('TESTER_LOGIN',     'john@mycompany.net');
define('TESTER_PASSWORD',  'john99');
define('TESTER_FIRSTNAME', 'John');
define('TESTER_LASTNAME',  'Anderson');
define('TESTER_FULLNAME',  'John Anderson');
define('TESTER_USER_ID',   4);

/* Demo login */
define('DEMO_LOGIN',     'john@mycompany.net');
define('DEMO_PASSWORD',  'john99');

/* Mail - disabled for Cloud Run */
define('MAIL_MAILER', 0);
define('MAIL_SENDMAIL_PATH', '/usr/sbin/sendmail');
define('MAIL_SMTP_HOST', 'localhost');
define('MAIL_SMTP_PORT', 587);
define('MAIL_SMTP_AUTH', true);
define('MAIL_SMTP_USER', 'user');
define('MAIL_SMTP_PASS', 'password');
define('MAIL_SMTP_SECURE', 'tls');

/* Event reminder email */
$GLOBALS['eventReminderEmail'] = <<<EOF
%FULLNAME%,

This is a reminder from the OpenCATS Applicant Tracking System about an
upcoming event.

'%EVENTNAME%'
Is scheduled to occur %DUETIME%.

Description:
%NOTES%

--
OPENCATS Applicant Tracking System
EOF;

/* Replication slave mode */
define('CATS_SLAVE', false);

/* Module caching */
define('CACHE_MODULES', false);

/* US Zips */
define('US_ZIPS_ENABLED', false);

/* LDAP - not used */
define('LDAP_HOST', 'localhost');
define('LDAP_PORT', '389');
define('LDAP_PROTOCOL_VERSION', 3);
define('LDAP_BASEDN', 'dc=example,dc=com');
define('LDAP_BIND_DN', 'cn=read-only-admin,dc=example,dc=com');
define('LDAP_BIND_PASSWORD', 'password');
define('LDAP_ACCOUNT', 'cn={$username},dc=example,dc=com');
define('LDAP_ATTRIBUTE_UID', 'uid');
define('LDAP_ATTRIBUTE_DN', 'dn');
define('LDAP_ATTRIBUTE_LASTNAME', 'sn');
define('LDAP_ATTRIBUTE_FIRSTNAME', 'givenname');
define('LDAP_ATTRIBUTE_EMAIL', 'mail');
define('LDAP_SITEID', 1);
define('LDAP_AD', false);

?>
