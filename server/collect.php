<?php
// Receives the beacons sent by /t.js and appends one JSON line per event to today's NDJSON file.
// Answers 204 (no body) on success and for events that are deliberately ignored (bots, Do Not Track).
// Never cached: the response carries Cache-Control: no-store, and POST requests are never cached by Cloudflare anyway.

ini_set('display_errors', '0');
define('EV_ENTRY', true);
require __DIR__ . '/analytics-lib.php';

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private');
header('Pragma: no-cache');
header('Expires: 0');
header('X-Content-Type-Options: nosniff');

function done(int $status): void
{
    http_response_code($status);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    done(405);
}

// Respect Do Not Track and Global Privacy Control: collect nothing.
if (($_SERVER['HTTP_DNT'] ?? '') === '1' || ($_SERVER['HTTP_SEC_GPC'] ?? '') === '1') {
    done(204);
}

// Same-origin only: if the browser says where the request came from, it must be this site.
$allowed = array_merge(['everyversion.net', 'www.everyversion.net', 'localhost', '127.0.0.1'], array_filter(explode(',', (string) getenv('EVERYVERSION_HOSTS'))));
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $host = parse_url($origin, PHP_URL_HOST);
    if (!$host || !in_array(strtolower($host), $allowed, true)) {
        done(403);
    }
}

// Small bodies only.
$raw = file_get_contents('php://input', false, null, 0, 4097);
if ($raw === false || $raw === '' || strlen($raw) > 2048) {
    done(400);
}
$in = json_decode($raw, true);
if (!is_array($in)) {
    done(400);
}

$ua = ev_parse_ua((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
if ($ua === null) {
    done(204); // bots and tools are not counted
}

// ---- validate: every field is checked against a whitelist or a strict pattern; anything else is dropped
$str = static function ($v, string $re, int $max = 100): ?string {
    if (!is_string($v) || $v === '' || strlen($v) > $max || !preg_match($re, $v)) {
        return null;
    }
    return $v;
};
$event = $in['e'] ?? null;
if (!in_array($event, EV_EVENTS, true)) {
    done(400);
}
$slug = $str($in['s'] ?? null, '/^[a-z0-9]+(-[a-z0-9]+)*$/', 80);
if ($slug !== null && !is_file(ev_root() . '/' . $slug . '/index.html')) {
    $slug = null; // not a real app page
}
if (($event === 'download' || $event === 'install') && $slug === null) {
    done(400);
}
$slot = in_array($in['sl'] ?? null, EV_SLOTS, true) ? $in['sl'] : null;
if ($event !== 'pageview' && $slot === null) {
    done(400);
}
$platform = in_array($in['pl'] ?? null, EV_PLATFORMS, true) ? $in['pl'] : null;
$arch = in_array($in['ar'] ?? null, EV_ARCHES, true) ? $in['ar'] : null;
$pageType = in_array($in['pt'] ?? null, EV_PAGE_TYPES, true) ? $in['pt'] : 'other';

// Referrer: the host only, and never our own.
$ref = null;
if (is_string($in['r'] ?? null) && strlen($in['r']) <= 100 && preg_match('/^[a-z0-9.-]+$/i', $in['r'])) {
    $r = strtolower($in['r']);
    $ref = in_array($r, $allowed, true) ? null : preg_replace('/^www\./', '', $r);
}

$country = strtoupper((string) ($_SERVER['HTTP_CF_IPCOUNTRY'] ?? ''));
if (!preg_match('/^[A-Z]{2}$/', $country) || in_array($country, ['XX', 'T1'], true)) {
    $country = 'XX'; // unknown (or Tor)
}

// The IP is read only to make today's visitor hash; it is never written anywhere.
$ip = (string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
$visitor = substr(hash('sha256', ev_salt() . '|' . $ip . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 16);

// ---- small rate limit per visitor per minute (a flood from one visitor cannot fill the disk)
$limit = 120;
$rateFile = ev_data_dir() . '/rate-' . gmdate('YmdHi') . '.json';
$fh = @fopen($rateFile, 'c+');
if ($fh) {
    flock($fh, LOCK_EX);
    $counts = json_decode((string) stream_get_contents($fh), true);
    $counts = is_array($counts) ? $counts : [];
    $counts[$visitor] = ($counts[$visitor] ?? 0) + 1;
    if ($counts[$visitor] <= $limit) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($counts));
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    foreach (glob(ev_data_dir() . '/rate-*.json') ?: [] as $old) {
        if ($old !== $rateFile && filemtime($old) < time() - 300) {
            @unlink($old);
        }
    }
    if ($counts[$visitor] > $limit) {
        done(429);
    }
}

$rec = array_filter([
    't' => time(),
    'e' => $event,
    'p' => $str($in['p'] ?? null, '#^/[A-Za-z0-9._/~-]{0,99}$#', 100),
    'pt' => $pageType,
    's' => $slug,
    'sl' => $slot,
    'pl' => $platform,
    'ar' => $arch,
    'ty' => $str($in['ty'] ?? null, '/^[a-z0-9._-]{1,20}$/i', 20),
    'h' => $str($in['h'] ?? null, '/^[a-z0-9.-]{1,80}$/i', 80),
    'v' => $str($in['v'] ?? null, '/^[A-Za-z0-9._+~-]{1,40}$/', 40),
    'c' => $country,
    'b' => $ua['b'],
    'bv' => $ua['bv'] ?: null,
    'o' => $ua['o'],
    'd' => $ua['d'],
    'l' => $str(strtolower(substr((string) ($in['l'] ?? ''), 0, 2)), '/^[a-z]{2}$/', 2),
    'r' => $ref,
    'us' => $str($in['us'] ?? null, '/^[A-Za-z0-9._-]{1,40}$/', 40),
    'uc' => $str($in['uc'] ?? null, '/^[A-Za-z0-9._-]{1,40}$/', 40),
    'w' => in_array($in['w'] ?? null, ['s', 'm', 'l'], true) ? $in['w'] : null,
    'u' => $visitor,
], static fn ($v) => $v !== null && $v !== '');

$file = ev_events_file(ev_today());
$isNewDay = !is_file($file);
if (@file_put_contents($file, json_encode($rec, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX) === false) {
    done(500);
}
if ($isNewDay) {
    ev_purge_old();
}
done(204);
