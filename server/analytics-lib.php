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

/** Ad click markers (the URL parameter an ad network adds to its clicks) and the kind of ad each one means. */
const EV_CLICK_IDS = [
    'gclid' => 'search', 'gbraid' => 'search', 'wbraid' => 'search', 'msclkid' => 'search', 'yclid' => 'search',
    'ttclid' => 'social', 'twclid' => 'social', 'li_fat_id' => 'social', 'ScCid' => 'social', 'epik' => 'social', 'rdt_cid' => 'social',
];

/** Channels, in the order the stats page lists them when they tie. */
const EV_CHANNELS = ['Direct', 'Organic Search', 'AI Organic Search', 'Social', 'Referral', 'Email', 'Paid Search', 'Paid Social', 'Other campaigns'];

/** True when $host is one of $domains or a subdomain of one. */
function ev_host_in(string $host, array $domains): bool
{
    foreach ($domains as $d) {
        if ($host === $d || str_ends_with($host, '.' . $d)) {
            return true;
        }
    }
    return false;
}

/** The kind of site a referrer host (or a utm_source written like one) is: ai, email, search, social, or null. */
function ev_source_kind(string $src): ?string
{
    $h = strtolower(preg_replace('/^www\./', '', trim($src)));
    if ($h === '') {
        return null;
    }
    // AI assistants and answer engines. ChatGPT and others also tag their links with utm_source=chatgpt.com and the like.
    if (ev_host_in($h, ['chatgpt.com', 'chat.openai.com', 'openai.com', 'perplexity.ai', 'claude.ai', 'gemini.google.com', 'bard.google.com', 'copilot.microsoft.com', 'copilot.cloud.microsoft', 'you.com', 'phind.com', 'poe.com', 'deepseek.com', 'meta.ai', 'grok.com', 'chat.mistral.ai', 'kimi.com', 'kimi.moonshot.cn', 'chat.qwen.ai', 'duck.ai', 'andisearch.com', 'komo.ai'])
        || preg_match('/^(chatgpt|openai|perplexity|claude|gemini|copilot|deepseek|grok|mistral|phind|poe|meta\.?ai)$/', $h)) {
        return 'ai';
    }
    if (ev_host_in($h, ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com', 'mail.aol.com', 'mail.proton.me', 'mail.zoho.com', 'mail.yandex.ru', 'mail.ru', 'gmx.net', 'web.de', 'fastmail.com'])
        || preg_match('/^(e-?mail|newsletter|gmail|outlook|mailchimp|substack)$/', $h)) {
        return 'email';
    }
    if (preg_match('/^(news\.)?google\.[a-z.]+$/', $h) || preg_match('/^(search\.|[a-z]{2}\.search\.)?yahoo\.[a-z.]+$/', $h) || preg_match('/^yandex\.[a-z.]+$/', $h)
        || ev_host_in($h, ['bing.com', 'duckduckgo.com', 'baidu.com', 'ecosia.org', 'search.brave.com', 'startpage.com', 'qwant.com', 'naver.com', 'seznam.cz', 'kagi.com', 'sogou.com', 'so.com', 'ask.com', 'search.aol.com', 'daum.net', 'ya.ru', 'mojeek.com', 'swisscows.com', 'metager.org', 'metager.de', 'petalsearch.com', 'presearch.com', 'search.lilo.org'])
        || preg_match('/^(google|bing|duckduckgo|ddg|yahoo|yandex|baidu|ecosia|brave|startpage|qwant|naver|kagi)$/', $h)) {
        return 'search';
    }
    if (ev_host_in($h, ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 't.co', 'x.com', 'twitter.com', 'linkedin.com', 'lnkd.in', 'reddit.com', 'redd.it', 'youtube.com', 'youtu.be', 'tiktok.com', 'threads.net', 'threads.com', 'bsky.app', 'mastodon.social', 'mstdn.social', 'news.ycombinator.com', 'discord.com', 'discordapp.com', 't.me', 'telegram.org', 'whatsapp.com', 'vk.com', 'quora.com', 'tumblr.com', 'medium.com', 'snapchat.com', 'weibo.com', 'producthunt.com', 'lemmy.world', 'tildes.net', 'pinterest.com'])
        || preg_match('/^([a-z]{2}\.)?pinterest\.[a-z.]+$/', $h)
        || preg_match('/^(facebook|fb|instagram|ig|twitter|x|linkedin|reddit|youtube|tiktok|threads|bluesky|bsky|mastodon|hackernews|hn|discord|telegram|whatsapp|pinterest|quora|snapchat)$/', $h)) {
        return 'social';
    }
    return null;
}

/**
 * The channel of one pageview, from its referrer host (r), utm_source (us), utm_medium (um) and ad click marker (ck).
 * Paid comes first (an ad click can carry a search or social referrer), then email, AI, search, social, any other site.
 */
function ev_channel(array $e): string
{
    $medium = strtolower(trim((string) ($e['um'] ?? '')));
    $source = (string) ($e['us'] ?? '');
    $ref = (string) ($e['r'] ?? '');
    $srcKind = $source !== '' ? ev_source_kind($source) : null;
    $refKind = $ref !== '' ? ev_source_kind($ref) : null;
    $click = EV_CLICK_IDS[$e['ck'] ?? ''] ?? null;

    if ($click === 'social' || (preg_match('/^(.*cp.*|ppc|retargeting|paid.*)$/', $medium) && ($srcKind === 'social' || $refKind === 'social'))) {
        return 'Paid Social';
    }
    if ($click === 'search' || preg_match('/^(.*cp.*|ppc|retargeting|paid.*)$/', $medium)) {
        return 'Paid Search';
    }
    if (preg_match('/^(e[-_ ]?mail|newsletter)$/', $medium) || $srcKind === 'email' || $refKind === 'email') {
        return 'Email';
    }
    if ($srcKind === 'ai' || $refKind === 'ai') {
        return 'AI Organic Search';
    }
    if ($medium === 'organic' || ($medium === '' && $srcKind === 'search') || ($source === '' && $refKind === 'search')) {
        return 'Organic Search';
    }
    if (preg_match('/^(social|social[-_ ]?(network|media)|sm)$/', $medium) || ($medium === '' && $srcKind === 'social') || ($source === '' && $refKind === 'social')) {
        return 'Social';
    }
    if ($medium !== '' && !preg_match('/^(referral|link|app)$/', $medium)) {
        return 'Other campaigns'; // tagged, but with a medium none of the channels above covers (display, affiliate ...)
    }
    if ($source !== '' || $ref !== '') {
        return 'Referral';
    }
    return 'Direct';
}

/** Add one day of raw events into a rollup array. */
function ev_rollup_day(string $day): array
{
    $r = ['d' => $day, 'pv' => 0, 'uv' => 0, 'dl' => 0, 'direct_deep' => [0, 0, 0], 'apps' => [], 'slots' => [], 'platforms' => [], 'hosts' => [], 'countries' => [], 'browsers' => [], 'os' => [], 'devices' => [], 'referrers' => [], 'pages' => [], 'langs' => [], 'channels' => []];
    $file = ev_events_file($day);
    $fh = is_file($file) ? @fopen($file, 'r') : false;
    if (!$fh) {
        return $r;
    }
    $seen = [];
    // Channel per visitor and day: the first channel that is not Direct, else Direct. Pages a visitor opens inside the
    // site carry no outside referrer, so counting each pageview on its own would file nearly everything under Direct.
    $visits = []; // visitor hash => [channel, pageviews, downloads & installs, type of the first page viewed]
    $inc = static function (array &$a, string $k, int $i = 0, int $by = 1): void {
        $a[$k] ??= [0, 0];
        $a[$k][$i] += $by;
    };
    while (($line = fgets($fh)) !== false) {
        $e = json_decode($line, true);
        if (!is_array($e) || empty($e['e'])) {
            continue;
        }
        $u = (string) ($e['u'] ?? '');
        if ($e['e'] === 'pageview') {
            $r['pv']++;
            if ($u !== '') {
                $ch = ev_channel($e);
                $visits[$u] ??= ['Direct', 0, 0];
                if ($visits[$u][0] === 'Direct' && $ch !== 'Direct') {
                    $visits[$u][0] = $ch;
                }
                $visits[$u][1]++;
                $visits[$u][3] ??= (string) ($e['pt'] ?? 'other');
            }
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
                if ($u !== '') {
                    $visits[$u] ??= ['Direct', 0, 0];
                    $visits[$u][2]++;
                }
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
    foreach ($visits as $v) {
        [$ch, $pv, $dl] = $v;
        $landing = $v[3] ?? 'other';
        if ($pv === 0) {
            continue; // clicks without a recorded pageview (a page left open overnight) belong to no visit today
        }
        $r['channels'][$ch] ??= [0, 0, 0];
        $r['channels'][$ch][0]++;
        $r['channels'][$ch][1] += $pv;
        $r['channels'][$ch][2] += $dl;
        // Direct visitors who landed straight on an app page: nobody types or bookmarks those addresses much, so most
        // are links shared in chats, email apps or documents that pass no referrer ("dark social").
        if ($ch === 'Direct' && $landing === 'app') {
            $r['direct_deep'][0]++;
            $r['direct_deep'][1] += $pv;
            $r['direct_deep'][2] += $dl;
        }
    }
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
            // A rollup cached before channels and the Direct landing split were counted is made again while the raw
            // events are still kept.
            if (is_array($c) && (isset($c['direct_deep']) || !is_file(ev_events_file($day)))) {
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
