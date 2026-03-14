<?php
// ChadStart PHP runtime worker.
// Protocol: {"id": N, "entry": "/path/to/fn.php", "event": {...}, "ctx": {...}}

while (($line = fgets(STDIN)) !== false) {
    $line = trim($line);
    if ($line === '') continue;
    $req = json_decode($line, true);
    try {
        require_once $req['entry'];
        $event = $req['event'] ?? [];
        $ctx   = $req['ctx']   ?? [];
        $result = function_exists('handler') ? handler($event, $ctx) : null;
        echo json_encode(['id' => $req['id'], 'result' => $result]) . "\n";
    } catch (Throwable $e) {
        echo json_encode(['id' => $req['id'], 'error' => $e->getMessage()]) . "\n";
    }
    fflush(STDOUT);
}
