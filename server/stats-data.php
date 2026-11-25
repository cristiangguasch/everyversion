<?php
// Public, aggregated statistics for the /statistics/ page, built from the NDJSON files (through per-day rollups).
// Nothing in the output can identify a visitor: only counts per day, app, button, country, browser, OS and so on.
//
//   /stats-data.php?days=30     the last N days ending today (UTC); N is 1 to 730
//
// Cache-Control is "private, max-age=60": the visitor's browser may reuse it for a minute, shared caches (Cloudflare) must not store it.

ini_set('display_errors', '0'); // never print PHP errors into the public JSON
define('EV_ENTRY', true);
require __DIR__ . '/analytics-lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=60');
header('X-Content-Type-Options: nosniff');

$days = max(1, min(730, (int) ($_GET['days'] ?? 30))); // 1 to 730 days

try {
    $series = [];
    $now = time();
    for ($i = $days - 1; $i >= 0; $i--) {
        $series[] = ev_rollup(gmdate('Y-m-d', $now - $i * 86400));
    }
} catch (Throwable $e) {
    http_response_code(503);
    echo json_encode(['error' => 'statistics are not available yet']);
    exit;
}

// Merge the per-day maps into totals. Visitors are counted per day, so the server reports them per day only; the page adds the daily counts for its Visitors tile (they are not de-duplicated across days).
$sumPairs = static function (string $key) use ($series): array {
    $out = [];
    foreach ($series as $d) {
        foreach ($d[$key] ?? [] as $k => $v) {
            $out[$k] ??= [0, 0];
            $out[$k][0] += $v[0];
            $out[$k][1] += $v[1];
        }
    }
    return $out;
};
$sumOne = static function (string $key) use ($series): array {
    $out = [];
    foreach ($series as $d) {
        foreach ($d[$key] ?? [] as $k => $v) {
            $out[$k] = ($out[$k] ?? 0) + $v;
        }
    }
    arsort($out);
    return $out;
};
$top = static function (array $a, int $n = 12): array {
    return array_slice($a, 0, $n, true);
};
$sortPairs = static function (array $a, int $by): array {
    uasort($a, static fn ($x, $y) => ($y[$by] <=> $x[$by]) ?: ($y[1 - $by] <=> $x[1 - $by]));
    return $a;
};

// Channels: channel => [visitors, pageviews, downloads & installs], each visitor counted once per day under one channel.
$channels = [];
foreach ($series as $d) {
    foreach ($d['channels'] ?? [] as $k => $v) {
        $channels[$k] ??= [0, 0, 0];
        for ($i = 0; $i < 3; $i++) {
            $channels[$k][$i] += $v[$i];
        }
    }
}
uasort($channels, static fn ($x, $y) => $y[0] <=> $x[0]);
// Of the Direct visitors, those whose first page was an app page (likely shared links): [visitors, pageviews, downloads].
$directDeep = [0, 0, 0];
foreach ($series as $d) {
    for ($i = 0; $i < 3; $i++) {
        $directDeep[$i] += $d['direct_deep'][$i] ?? 0;
    }
}

$apps = $sortPairs($sumPairs('apps'), 1);
$countries = $sortPairs($sumPairs('countries'), 0);

echo json_encode([
    'generated' => gmdate('c'),
    'days' => $days,
    // ch: visitors per channel that day (each visitor under one channel)
    'series' => array_map(static fn ($d) => ['d' => $d['d'], 'pv' => $d['pv'], 'uv' => $d['uv'], 'dl' => $d['dl'], 'ch' => (object) array_map(static fn ($v) => $v[0], $d['channels'] ?? [])], $series),
    'apps' => $top($apps, 15),          // slug => [pageviews, downloads & installs]
    'countries' => $top($countries, 15), // country code => [pageviews, downloads & installs]
    'slots' => $sumOne('slots'),         // "platform|button" => clicks
    'platforms' => $sumOne('platforms'),
    'hosts' => $top($sumOne('hosts'), 10),
    'browsers' => $top($sumOne('browsers'), 10),
    'os' => $top($sumOne('os'), 10),
    'devices' => $sumOne('devices'),
    'channels' => $channels,             // channel => [visitors, pageviews, downloads & installs]
    'direct_deep' => $directDeep,        // part of Direct that landed straight on an app page
    'ai' => $sumOne('ai'),               // Copy for AI menu clicks, by item
    'referrers' => $top($sumOne('referrers'), 10),
    'pages' => $sumOne('pages'),
    'langs' => $top($sumOne('langs'), 10),
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
