<?php
// Shared helpers for the first-party analytics (collect.php writes events, stats-data.php reads them).
//
// What is stored: one JSON line per event in <data dir>/events-YYYY-MM-DD.ndjson (UTC day). No IP address, no cookie,
// no raw user agent. "Visitors" are counted per day from a hash of (today's random salt + IP + user agent); the salt is
// deleted at the end of the day, so the hash cannot be recomputed or followed across days.
//
// Data directory (first one that exists or can be created, and is writable):
//   1. the EVERYVERSION_DATA environment variable
//   2. <parent of the web root>/everyversion-data     (recommended: not reachable from the web at all)
//   3. <web root>/_data                               (fallback: gets a deny-all .htaccess, and the site .htaccess blocks it too)

if (!defined('EV_ENTRY')) {
    http_response_code(404);
    exit;
}

const EV_RETENTION_DAYS = 400; // raw event files (they hold the visitor hashes) are deleted after this; daily rollups are kept

function ev_root(): string
{
    return rtrim($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__), '/');
}

function ev_data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $root = ev_root();
    $candidates = array_filter([getenv('EVERYVERSION_DATA') ?: null, dirname($root) . '/everyversion-data', $root . '/_data']);
    foreach ($candidates as $c) {
        if ((is_dir($c) || @mkdir($c, 0750, true)) && is_writable($c)) {
            $real = realpath($c);
            $rootReal = realpath($root);
            if ($real && $rootReal && strpos($real . '/', $rootReal . '/') === 0 && !is_file($c . '/.htaccess')) {
                // Inside the web root: refuse all web access to it.
                @file_put_contents($c . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
            }
            return $dir = $c;
        }
    }
    throw new RuntimeException('no writable data directory');
}

function ev_today(): string
{
    return gmdate('Y-m-d');
}

function ev_events_file(string $day): string
{
    return ev_data_dir() . '/events-' . $day . '.ndjson';
}

function ev_rollup_file(string $day): string
{
    return ev_data_dir() . '/rollup-' . $day . '.json';
}

/** Today's random salt. Created on first use; every older salt is deleted, so yesterday's hashes can never be recomputed. */
function ev_salt(): string
{
    $dir = ev_data_dir();
    $file = $dir . '/salt-' . ev_today() . '.key';
    if (!is_file($file)) {
        $fh = @fopen($file, 'x'); // 'x' = fail if another request just created it
        if ($fh) {
            fwrite($fh, bin2hex(random_bytes(32)));
            fclose($fh);
            foreach (glob($dir . '/salt-*.key') ?: [] as $old) {
                if ($old !== $file) {
                    @unlink($old);
                }
            }
        }
    }
    $salt = @file_get_contents($file);
    return $salt !== false && $salt !== '' ? $salt : hash('sha256', 'fallback-' . ev_today());
}

/** Delete raw event files past the retention period (rollups stay: they hold no visitor hashes). */
function ev_purge_old(): void
{
    $limit = gmdate('Y-m-d', time() - EV_RETENTION_DAYS * 86400);
    foreach (glob(ev_data_dir() . '/events-*.ndjson') ?: [] as $f) {
        if (preg_match('/events-(\d{4}-\d{2}-\d{2})\.ndjson$/', $f, $m) && $m[1] < $limit) {
            @unlink($f);
        }
    }
}

/** Browser, OS and device class from a user agent. Returns null for bots. Only these parsed values are ever stored. */
function ev_parse_ua(string $ua): ?array
{
    if ($ua === '' || preg_match('/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|curl|wget|python|java\/|go-http|httpclient|okhttp|scrapy|monitor|uptime|preview|facebookexternalhit|embedly|fetch|check/i', $ua)) {
        return null;
    }
    $browser = 'Other';
    $ver = '';
    $rules = [
        ['Edge', '/Edg(?:e|A|iOS)?\/(\d+)/'],
        ['Opera', '/(?:OPR|Opera)\/(\d+)/'],
        ['Samsung Internet', '/SamsungBrowser\/(\d+)/'],
        ['Vivaldi', '/Vivaldi\/(\d+)/'],
        ['Brave', '/Brave\/(\d+)/'],
        ['Firefox', '/(?:Firefox|FxiOS)\/(\d+)/'],
        ['Chrome', '/(?:Chrome|CriOS)\/(\d+)/'],
        ['Safari', '/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/'],
    ];
    foreach ($rules as [$name, $re]) {
        if (preg_match($re, $ua, $m)) {
            $browser = $name;
            $ver = $m[1];
            break;
        }
    }
    if ($browser === 'Other' && stripos($ua, 'Safari') !== false) {
        $browser = 'Safari';
    }
    if (preg_match('/iPhone|iPad|iPod/', $ua)) {
        $os = 'iOS';
    } elseif (stripos($ua, 'Android') !== false) {
        $os = 'Android';
    } elseif (stripos($ua, 'CrOS') !== false) {
        $os = 'ChromeOS';
    } elseif (stripos($ua, 'Windows') !== false) {
        $os = 'Windows';
    } elseif (stripos($ua, 'Mac OS X') !== false || stripos($ua, 'Macintosh') !== false) {
        $os = 'macOS';
    } elseif (stripos($ua, 'Linux') !== false || stripos($ua, 'X11') !== false) {
        $os = 'Linux';
    } else {
        $os = 'Other';
    }
    if (preg_match('/iPad|Tablet|Tab |Nexus 7|Nexus 9|SM-T/i', $ua) || ($os === 'Android' && stripos($ua, 'Mobile') === false)) {
        $device = 'tablet';
    } elseif (preg_match('/Mobi|iPhone|iPod|Android/i', $ua)) {
        $device = 'mobile';
    } else {
        $device = 'desktop';
    }
    return ['b' => $browser, 'bv' => $ver, 'o' => $os, 'd' => $device];
}

/** Which kinds of events exist, and which button slots (values the client may send). Anything else is dropped. */
const EV_EVENTS = ['pageview', 'download', 'install', 'copy'];
const EV_SLOTS = ['row', 'version', 'install', 'copy-install', 'copy-run', 'copy-winget', 'copy-brew', 'copy-flatpak'];
const EV_PAGE_TYPES = ['home', 'app', 'platform', 'category', 'other'];
const EV_PLATFORMS = ['windows', 'macos', 'linux'];
const EV_ARCHES = ['x86', 'x64', 'arm', 'arm64', 'neutral', 'universal'];

/** Add one day of raw events into a rollup array. */
function ev_rollup_day(string $day): array
{
    $r = ['d' => $day, 'pv' => 0, 'uv' => 0, 'dl' => 0, 'apps' => [], 'slots' => [], 'platforms' => [], 'hosts' => [], 'countries' => [], 'browsers' => [], 'os' => [], 'devices' => [], 'referrers' => [], 'pages' => [], 'langs' => []];
    $file = ev_events_file($day);
    $fh = is_file($file) ? @fopen($file, 'r') : false;
    if (!$fh) {
        return $r;
    }
    $seen = [];
    $inc = static function (array &$a, string $k, int $i = 0, int $by = 1): void {
        $a[$k] ??= [0, 0];
        $a[$k][$i] += $by;
    };
    while (($line = fgets($fh)) !== false) {
        $e = json_decode($line, true);
        if (!is_array($e) || empty($e['e'])) {
            continue;
        }
        if ($e['e'] === 'pageview') {
            $r['pv']++;
            if (!empty($e['u'])) {
                $seen[$e['u']] = true;
            }
            if (!empty($e['s'])) {
                $inc($r['apps'], $e['s'], 0);
            }
            $inc($r['countries'], $e['c'] ?? 'XX', 0);
            foreach (['browsers' => 'b', 'os' => 'o', 'devices' => 'd', 'pages' => 'pt', 'langs' => 'l', 'referrers' => 'r'] as $key => $f) {
                if (!empty($e[$f])) {
                    $r[$key][$e[$f]] = ($r[$key][$e[$f]] ?? 0) + 1;
                }
            }
        } else {
            // A click: "Downloads & installs" counts the Download buttons and the Install button.
            $isDl = $e['e'] === 'download' || $e['e'] === 'install';
            if ($isDl) {
                $r['dl']++;
                if (!empty($e['s'])) {
                    $inc($r['apps'], $e['s'], 1);
                }
                $inc($r['countries'], $e['c'] ?? 'XX', 1);
                if (!empty($e['pl'])) {
                    $r['platforms'][$e['pl']] = ($r['platforms'][$e['pl']] ?? 0) + 1;
                }
                if (!empty($e['h']) && $e['e'] === 'download') {
                    $r['hosts'][$e['h']] = ($r['hosts'][$e['h']] ?? 0) + 1;
                }
            }
            if (!empty($e['sl'])) {
                $key = ($e['pl'] ?? '-') . '|' . $e['sl'];
                $r['slots'][$key] = ($r['slots'][$key] ?? 0) + 1;
            }
        }
    }
    fclose($fh);
    $r['uv'] = count($seen);
    return $r;
}

/** A day's rollup. Past days are computed once and kept; today is recomputed at most every 30 seconds. */
function ev_rollup(string $day): array
{
    $cache = ev_rollup_file($day);
    $today = $day === ev_today();
    if (is_file($cache)) {
        // Today: reuse for 30 seconds. A past day: reuse only if the cache was written after that day had ended
        // (a cache written during the day, e.g. at 23:59, would miss the last events).
        $dayEnd = strtotime($day . ' 23:59:59 UTC') + 120;
        $fresh = $today ? (time() - filemtime($cache) < 30) : filemtime($cache) >= $dayEnd;
        if ($fresh) {
            $c = json_decode((string) @file_get_contents($cache), true);
            if (is_array($c)) {
                return $c;
            }
        }
    }
    $r = ev_rollup_day($day);
    // A past day with no raw file and no cache is just an empty day; do not write a file for it.
    if (is_file(ev_events_file($day)) || $today) {
        @file_put_contents($cache, json_encode($r, JSON_UNESCAPED_SLASHES), LOCK_EX);
    }
    return $r;
}
