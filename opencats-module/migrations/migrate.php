<?php
/**
 * Simple migration runner for OpenCATS enrichment module.
 *
 * Usage: php migrate.php [--host=localhost] [--port=3306] [--db=opencats] [--user=opencats] [--pass=password]
 *
 * Reads .sql files from this directory in alphabetical order and executes them.
 * Tracks applied migrations in a `enrichment_migrations` table.
 */

$options = getopt('', ['host:', 'port:', 'db:', 'user:', 'pass:']);

$host = $options['host'] ?? getenv('DB_HOST') ?: 'localhost';
$port = $options['port'] ?? getenv('DB_PORT') ?: '3306';
$db   = $options['db']   ?? getenv('DB_NAME') ?: 'opencats';
$user = $options['user'] ?? getenv('DB_USER') ?: 'opencats';
$pass = $options['pass'] ?? getenv('DB_PASSWORD') ?: '';

try {
    $pdo = new PDO("mysql:host={$host};port={$port};dbname={$db}", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);

    // Create migrations tracking table if not exists
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS enrichment_migrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL UNIQUE,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ");

    // Get already-applied migrations
    $applied = $pdo->query("SELECT filename FROM enrichment_migrations")
        ->fetchAll(PDO::FETCH_COLUMN);

    // Find .sql migration files
    $migrationDir = __DIR__;
    $files = glob("{$migrationDir}/*.sql");
    sort($files);

    $count = 0;
    foreach ($files as $file) {
        $filename = basename($file);
        if (in_array($filename, $applied)) {
            echo "SKIP: {$filename} (already applied)\n";
            continue;
        }

        echo "APPLYING: {$filename}...\n";
        $sql = file_get_contents($file);
        $pdo->exec($sql);

        $stmt = $pdo->prepare("INSERT INTO enrichment_migrations (filename) VALUES (?)");
        $stmt->execute([$filename]);

        echo "  OK: {$filename}\n";
        $count++;
    }

    echo "\nDone. Applied {$count} migration(s).\n";

} catch (PDOException $e) {
    fprintf(STDERR, "Migration error: %s\n", $e->getMessage());
    exit(1);
}
