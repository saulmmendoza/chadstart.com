<?php
// hello.php — ChadStart PHP function
// Returns a greeting from the PHP runtime.
//
// Runtime: php
// Trigger: GET /api/fn/greet/php (public)

function handler(array $event, array $ctx): array {
    $name = $event['query']['name'] ?? 'World';
    return [
        'message' => "Hello, {$name}!",
        'runtime' => 'php',
    ];
}
