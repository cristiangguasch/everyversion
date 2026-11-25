// Static pages: about, contact, legal hub + policies. Each builder returns { path, title, description, body, ld? }.
// Copy is written for build.mjs's layout(); keep it plain HTML.

// Public contact address. Change this one line to change it everywhere.
// Contact form is delivered by Formspree (https://formspree.io). Create a form there pointed at your inbox,
// then paste its ID (the part after /f/ in the endpoint) here. The email address never appears on the site.
export const FORMSPREE_ID = 'xpppbdgg';
export const AUTHOR = 'Cristian Gonzalez Guasch';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/cristiangonzalezguasch/';
export const ADDRESS = '505 Ocean Ave, Brooklyn, New York, USA, 11226';
export const AUTHOR_URL = 'https://cristianguasch.com/';
export const AUTHOR_ID = 'https://everyversion.net/about/#author';
export const PERSON = {
  '@type': 'Person',
  '@id': AUTHOR_ID,
  name: AUTHOR,
  url: AUTHOR_URL,
  mainEntityOfPage: 'https://everyversion.net/about/',
  sameAs: [AUTHOR_URL, LINKEDIN_URL],
};

const TOPICS = [
  ['app', 'Request an app'],
  ['data', 'Report wrong data'],
  ['publisher', 'Publisher request or takedown'],
  ['privacy', 'Privacy question'],
  ['other', 'Something else'],
];
const topicLink = (t) => `/contact/?topic=${t}#form`;
const fmt = (n) => n.toLocaleString('en-US');

export const LEGAL_UPDATED = '2026-11-07';

const crumbs = (...parts) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › ${parts.map(([href, label]) => (href ? `<a href="${href}">${label}</a>` : label)).join(' › ')}</nav>`;

// ------------------------------------------------------------------ about

export function aboutPage({ apps, versions, checked }) {
  const body = `
${crumbs([null, 'About'])}
<article class="prose">
<h1>Newer isn’t always better</h1>
<p class="lead">I’m <a href="${AUTHOR_URL}">${AUTHOR}</a>. I built Everyversion so you can get the version of your software that actually works for you.</p>
<p class="updated">Written 4 November 2026, for anyone stuck on an update they never asked for.</p>

<p>I used to <a href="${LINKEDIN_URL}">work for Softonic</a>.</p>

<p>Every day I saw the same thing. Someone on an older computer would search for a program they’d used for years. The latest release wouldn’t run on their machine. The old one was gone from the publisher’s site. So they went hunting, and they ended up on whatever page promised the file.</p>

<p>That’s how people get hurt. Not by the software they wanted, but by the “installer” that came with it.</p>

<h2>Three things go wrong with new versions</h2>
<ul class="clean">
<li><strong>They get hungry.</strong> A newer release wants more memory, a newer processor, a newer OS. Your hardware works fine. The software just stopped caring about it.</li>
<li><strong>They lose the features you loved.</strong> Menus get hidden. Options vanish. The tool you learned in an afternoon becomes a tool you have to relearn.</li>
<li><strong>They sometimes come with passengers.</strong> Some versions bundle adware or spyware. Your privacy is the price of “free”.</li>
</ul>
<p>None of that is rare. If you’ve ever clicked “Update” and wished you hadn’t, you know exactly what I mean.</p>

<h2>What I’m doing about it</h2>
<p>I’m building a plain, fast index of older versions of the software people use, with a link to the publisher’s download location for each one. Today that’s <strong>${fmt(apps)} apps</strong> and <strong>${fmt(versions)} versions</strong>. It will grow.</p>
<p>Every version page shows the same things, in the same order:</p>
<ul class="clean">
<li>The download link, from the publisher’s own servers or from repositories and archives. We host no installers, so we can’t slip anything into one.</li>
<li>The SHA-256 checksum, so you can check the file before you run it.</li>
<li>The release date, the license, and a plain summary of what the installer does.</li>
<li>Release notes, when the publisher wrote them.</li>
</ul>

<h2>What I’m aiming for</h2>
<div class="card">
<ol class="goals">
<li><strong>Fight spyware and adware</strong> by offering clean, legacy alternatives.</li>
<li><strong>Support people on older computers</strong> who can’t run modern software.</li>
<li><strong>Protect your choice.</strong> If a vendor won’t keep past versions available, someone should.</li>
<li><strong>Preserve digital history,</strong> so future generations can see how software evolved.</li>
</ol>
</div>

<h2>What I won’t do</h2>
<p>I won’t host files. I won’t wrap a download in an “installer manager”. I won’t put ads in front of a download button. Links go to the publisher, and that’s the whole trick.</p>
<p>I’ll also tell you what I have and haven’t done. For <strong>${fmt(checked)} of the ${fmt(apps)} apps</strong>, the latest installers were downloaded, their SHA-256 re-computed and their code signatures checked where possible. Each of those pages shows the result and the date. For the rest, the checksums are copied from the upstream package manifests, and the page says so. If it hasn’t been verified, I won’t pretend it was.</p>

<h2 id="checks">Who checks the files</h2>
<p>Three names appear next to “Verified by” on an app page. Each one does a different job.</p>

<h3 id="cristian">Cristian</h3>
<p>That’s me. I pick the apps, set the rules for what counts as checked, read the reports and fix the data when something is wrong. If a page is wrong, it’s on me.</p>

<h3 id="claude">Claude</h3>
<p><a href="https://www.anthropic.com/claude">Claude</a> is an AI model made by Anthropic. I use it to run the update process from start to finish. It reads the package catalogs (winget, Homebrew and Flathub) for new versions, downloads the latest installers from the publisher’s servers, re-computes each SHA-256 and compares it with the published one, and checks the code signature. It also tests every download link and looks up each file on VirusTotal.</p>
<p>Claude reports every result to me, including the downloads that failed, and it never rates a file by hand: the scores come from the checks themselves. I review the report before anything goes live.</p>

<h3 id="virustotal">VirusTotal</h3>
<p><a href="https://www.virustotal.com/">VirusTotal</a> scans files with dozens of antivirus and security engines. We look up each installer by its SHA-256 and show the real result from VirusTotal’s last scan. Only the hash is sent, never the file, and if VirusTotal has no report we show no score. We are not affiliated with VirusTotal. The <a href="/security/">Security and Trust Center</a> explains how the score is worked out.</p>

<h2 id="source">The code and data are public</h2>
<p>Everything that builds this site is on GitHub: <a href="https://github.com/cristiangguasch/everyversion">github.com/cristiangguasch/everyversion</a>. You don’t have to take my word for how the checks work. You can read them.</p>
<ul class="clean">
<li><strong>The scripts</strong> that read winget, Homebrew and Flathub, download installers, re-compute checksums, check signatures and test links.</li>
<li><strong>The data</strong> behind every page: one JSON file per app, with each version, download URL and SHA-256, plus the verification and VirusTotal results.</li>
<li><strong>The history.</strong> Every update is a commit, so you can see when a version was added or a link was marked dead, and what changed.</li>
</ul>
<p>Found a wrong version, a broken link or a mistake in a summary? <a href="https://github.com/cristiangguasch/everyversion/issues">Open an issue</a> on GitHub, or use the <a href="/contact/">contact form</a> if you’d rather not have an account.</p>

<h2 id="brand">Brand guidelines</h2>
<p>If you’re writing about Everyversion or linking to it, here’s how it looks and sounds.</p>
<div class="card brand-card">
<div class="brand-logo"><svg viewBox="0 0 32 32" width="56" height="56" role="img" aria-label="The Everyversion mark"><rect width="32" height="32" rx="8" fill="#1d4fe0"/><g fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 8l7.5 7 7.5-7" stroke-opacity=".3"/><path d="M8.5 12.5l7.5 7 7.5-7" stroke-opacity=".62"/><path d="M8.5 17l7.5 7 7.5-7"/></g></svg><span class="brand-wm">everyversion<span>.net</span></span></div>
<p>Three stacked chevrons: versions piled up over time, with the one you choose in front. Use the full logo where there’s room and the mark alone where there isn’t.</p>
<p class="brand-dl">Logo: <a href="/brand/logo.svg">SVG</a>, <a href="/brand/logo-dark.svg">SVG for dark backgrounds</a>, <a href="/brand/logo.png">PNG</a>. Mark only: <a href="/brand/mark.svg">SVG</a>, <a href="/brand/mark-512.png">PNG</a>. Please don’t recolor, rotate or add shadows.</p>
</div>

<h3>The name</h3>
<ul class="clean">
<li>In sentences and titles, write <strong>Everyversion</strong>: one word, capital E only. Not “Every Version” or “EveryVersion”.</li>
<li>In the logo, the wordmark is lowercase <strong>everyversion</strong>, with a lighter <strong>.net</strong> that can be dropped when space is tight.</li>
<li>For links, use <code>everyversion.net</code>.</li>
</ul>

<h3>Colors</h3>
<ul class="swatches">
<li><span class="sw" style="background:#1d4fe0"></span><strong>Version Blue</strong> <code>#1d4fe0</code><br>Brand, links, primary buttons.</li>
<li><span class="sw" style="background:#0a7d52"></span><strong>Verified Green</strong> <code>#0a7d52</code><br>Only for “checked” and “safe to download”.</li>
<li><span class="sw" style="background:#15181d"></span><strong>Ink</strong> <code>#15181d</code><br>Text.</li>
<li><span class="sw" style="background:#5b6472"></span><strong>Muted</strong> <code>#5b6472</code><br>Secondary text and the <code>.net</code>.</li>
</ul>

<h3>Type</h3>
<p>Headings and the wordmark use <strong>Geist</strong>. Body text uses your system font, so pages load fast and look at home on your device. Hashes and versions use a monospace font.</p>

<h3>Voice</h3>
<p>Friendly, but not slang. Bold and honest. We say what we checked and what we didn’t, we state a risk as a fact instead of a scare, and we pick the specific claim (“official links, SHA-256 checksums, no installers hosted”) over the adjective.</p>

<h2>Is your favorite app missing?</h2>
<p>Good. Tell me. I add apps based on what people ask for, so your email moves the list.</p>
<p><a class="btn" href="/contact/">Request an app</a> <a href="/#apps">or browse what’s here now</a></p>

<p class="sign">— <a href="${AUTHOR_URL}">${AUTHOR}</a></p>
</article>`;
  return {
    path: '/about/',
    title: `About Everyversion – Older Software Versions, Without the Junk`,
    description: `Built by ${AUTHOR}, a former Softonic employee, to help people find clean older versions of their favorite software.`,
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'AboutPage',
            '@id': 'https://everyversion.net/about/#page',
            name: 'About Everyversion',
            url: 'https://everyversion.net/about/',
            mainEntity: { '@id': AUTHOR_ID },
            author: { '@id': AUTHOR_ID },
            about: { '@type': 'WebSite', name: 'Everyversion', url: 'https://everyversion.net/' },
          },
          PERSON,
        ],
      },
    ],
  };
}

// ------------------------------------------------------------------ contact

export function contactPage() {
  const body = `
${crumbs([null, 'Contact'])}
<article class="prose">
<h1>Contact</h1>
<p class="lead">One person reads these messages: ${AUTHOR}. Write plainly, and I’ll write back the same way.</p>

<form id="form" class="contact" action="https://formspree.io/f/${FORMSPREE_ID}" method="POST">
<p><label for="c-name">Your name</label><input id="c-name" name="name" type="text" autocomplete="name" required></p>
<p><label for="c-email">Your email <span class="host" style="display:inline">so I can reply</span></label><input id="c-email" name="email" type="email" autocomplete="email" required></p>
<p><label for="c-topic">What is this about?</label><select id="c-topic" name="topic">
${TOPICS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('\n')}
</select></p>
<p><label for="c-msg">Message</label><textarea id="c-msg" name="message" rows="7" required></textarea></p>
<p class="sr" aria-hidden="true"><label>Leave this empty <input name="_gotcha" type="text" tabindex="-1" autocomplete="off"></label></p>
<p><button class="btn" type="submit">Send message</button></p>
<p class="pin" id="c-status" role="status" aria-live="polite"></p>
<p class="pin">Messages are delivered by Formspree. See the <a href="/legal/privacy/">privacy policy</a>.</p>
</form>
<script>
(()=>{const f=document.getElementById('form'),st=document.getElementById('c-status'),t=new URLSearchParams(location.search).get('topic');
if(t){const s=document.getElementById('c-topic');if([...s.options].some(o=>o.value===t))s.value=t}
f.addEventListener('submit',async(e)=>{e.preventDefault();st.textContent='Sending…';
try{const r=await fetch(f.action,{method:'POST',body:new FormData(f),headers:{Accept:'application/json'}});
if(r.ok){f.reset();st.textContent='Thanks. Your message is on its way.'}else st.textContent='Something went wrong. Please try again in a moment.'}
catch(_){st.textContent='Could not send. Check your connection and try again.'}})})();
</script>

<h2>Which topic?</h2>
<ul class="clean">
<li><strong>Request an app.</strong> Tell me the name and the version you need. If you’re on old hardware, say which OS. It helps me prioritise.</li>
<li><strong>Report wrong data.</strong> A bad link, a wrong version, a checksum that doesn’t match. Send the page URL and what you saw.</li>
<li><strong>You’re a publisher.</strong> Want a link changed or removed? Use an address on your domain. See <a href="/legal/content/">content &amp; takedown requests</a>.</li>
<li><strong>Privacy question.</strong> See the <a href="/legal/privacy/">privacy policy</a> first. It’s short.</li>
<li><strong>Anything else.</strong> Press, ideas, a kind word.</li>
</ul>

<h2>What helps me answer fast</h2>
<ul class="clean">
<li>The page URL, for example <code>https://everyversion.net/vlc/</code>.</li>
<li>The version number you’re looking at.</li>
<li>For a bad checksum: the file name and the hash you computed.</li>
</ul>

<h2>Data and code</h2>
<p>Developers can read everything the site knows without writing to anyone: <a href="/api/v1/apps.json">the JSON index</a>, the <a href="/schema/app.schema.json">JSON Schema</a>, and <a href="/llms.txt">llms.txt</a>.</p>
</article>`;
  return {
    path: '/contact/',
    title: 'Contact Everyversion – Request an App or Report an Error',
    description: 'Message the maker of Everyversion to request an app, report wrong data, or send a publisher or privacy request.',
    body,
    ld: [{ '@context': 'https://schema.org', '@type': 'ContactPage', name: 'Contact Everyversion', url: 'https://everyversion.net/contact/' }],
  };
}

// ------------------------------------------------------------------ security & trust center

export function securityPage({ apps, checked, files }) {
  const body = `
${crumbs([null, 'Security and Trust Center'])}
<article class="prose">
<h1>Security and Trust Center</h1>
<p class="lead">You should be able to see exactly how a file was checked before you run it. Here is the whole process, including what it cannot tell you.</p>
<p class="updated">Checks run and maintained by <a href="/about/" rel="author">${AUTHOR}</a>. So far: <strong>${fmt(checked)} of ${fmt(apps)} apps</strong> and <strong>${fmt(files)} files</strong> checked end to end.</p>

<h2>The short version</h2>
<ul class="clean">
<li>We host no installers. Every download link goes to the download location named in the package data: normally the publisher, or a repository or archive. We can’t guarantee what is there.</li>
<li>For checked software, we download the files ourselves and re-compute their SHA-256.</li>
<li>We check the code signature where our tools can.</li>
<li>We look each file up on VirusTotal by its hash and show the real result. We never invent a score.</li>
<li>Every result carries a date, so you can see how old it is.</li>
</ul>

<h2>How a file gets checked</h2>
<ol class="goals">
<li><strong>Source.</strong> We start from public package catalogs. Each app page names its source, the revision we read and the date.</li>
<li><strong>Download.</strong> We fetch the installer from its original source, not from a mirror of ours.</li>
<li><strong>Hash.</strong> We re-compute the SHA-256 and compare it with the catalog’s value. A match means the file is byte for byte the one that was recorded. If it does not match, the page says so in plain words.</li>
<li><strong>Signature.</strong> For Windows files we verify the Authenticode signature, including its timestamp, against the operating system’s trusted roots plus a small set of Microsoft roots whose fingerprints we checked against Microsoft’s own published list. For macOS files we run Apple’s <code>codesign</code>.</li>
<li><strong>VirusTotal.</strong> We look up the file’s SHA-256 on <a href="https://www.virustotal.com/">VirusTotal</a>. This sends only the hash, never the file.</li>
<li><strong>Publish.</strong> The page shows each result and its date. We delete the downloaded files afterwards.</li>
</ol>

<h2>Verification levels</h2>
<div class="scroll"><table>
<thead><tr><th scope="col">Level</th><th scope="col">What it means</th></tr></thead>
<tbody>
<tr><td>0</td><td>The checksum is copied from the package catalog. We have not re-computed it.</td></tr>
<tr><td>1</td><td>We downloaded the files from the source, re-computed the SHA-256 and checked signatures where our tools could.</td></tr>
</tbody></table></div>

<h2>How to read the score</h2>
<p>The score on an app page comes from VirusTotal’s last scan. VirusTotal runs a file through dozens of security engines. We take the share of engines that did <em>not</em> flag the file:</p>
<p><code>score = 100 × (engines − malicious − suspicious) ÷ engines</code></p>
<ul class="clean">
<li><strong>Green, Clean or Mostly clean.</strong> No engine, or just one engine, flagged any scanned file. A lone flag among 50 or more engines is usually a false alarm, so it does not change the rating. We still list it under Detections.</li>
<li><strong>Orange, Some detections.</strong> Two or three engines flagged a file. Open the full report.</li>
<li><strong>Red, Many detections.</strong> Four or more engines flagged a file. Do not run it before you read the report.</li>
<li><strong>No ring, Not scanned yet.</strong> VirusTotal has no report for that hash, or we have not looked it up yet. We show no score.</li>
</ul>
<p><strong>Checksum mismatches.</strong> If a file we downloaded does not hash to the checksum published in the package catalog, the app is rated no better than “Medium risk” whatever its VirusTotal result, and the page says so. This usually means the publisher replaced the file after the catalog entry was written, but we cannot tell that from here.</p>
<p>The label under the title on an app page follows the same colors: green is “Safe”, orange is “Medium risk”, red is “High risk”, and no scan is “Not scanned”. “Safe so far” means the files we could scan are clean but some files have no report yet.</p>
<p>When an app has several installers, the ring shows the lowest score and the colour follows the most-flagged file. If VirusTotal has a report for only some of the files, the page says “Covers X of Y files” and the label becomes “No detections so far” instead of “Clean”. A partial result never speaks for the files it did not scan.</p>

<h2>What these checks cannot tell you</h2>
<ul class="clean">
<li>A clean scan is not a guarantee. Scanners miss things, and new malware can go unflagged for days.</li>
<li>A matching hash proves the file is the one that was published. It does not prove the publisher’s file is harmless.</li>
<li>A valid signature proves who signed the file and that it was not changed afterwards. It does not prove the software is good.</li>
<li>“Not signed” on a macOS disk image means the image itself carries no signature. The app inside may still be signed. We have not checked that yet.</li>
<li>Some formats, such as ZIP archives and <code>.msix</code> packages, are not signature-checked by our tools. The page shows “Not applicable”.</li>
<li>Older versions can contain security flaws that later versions fixed. That is the trade you make when you choose them. See the <a href="/legal/disclaimer/">disclaimer</a>.</li>
<li>We are not affiliated with VirusTotal or any publisher.</li>
</ul>

<h2>What we do not do yet</h2>
<ul class="clean">
<li>We do not monitor publishers, domains or certificates for changes.</li>
<li>We do not re-scan on a schedule. Each result shows its date.</li>
<li>We do not check the apps inside macOS disk images.</li>
</ul>

<h2>Check it yourself</h2>
<p>Do not take our word for it. These commands take seconds.</p>
<div class="card">
<p><strong>Hash</strong></p>
<p><code>Get-FileHash .\\&lt;file&gt; -Algorithm SHA256</code> (PowerShell)<br><code>shasum -a 256 ~/Downloads/&lt;file&gt;</code> (macOS)</p>
<p><strong>Signature</strong></p>
<p><code>Get-AuthenticodeSignature .\\&lt;file&gt;</code> (PowerShell)<br><code>codesign --verify --strict -vv &lt;file&gt;</code> (macOS)</p>
<p><strong>VirusTotal</strong></p>
<p>Open <code>https://www.virustotal.com/gui/file/&lt;sha256&gt;</code> with the file’s SHA-256.</p>
</div>

<h2>Found something wrong?</h2>
<p>If a result looks wrong, a link is dead, or a hash does not match what you computed, <a href="/contact/">tell us</a>. Send the page URL and the value you got. We will re-check it and fix the page.</p>
</article>`;
  return {
    path: '/security/',
    title: 'Security and Trust Center – How We Check Every File | Everyversion',
    description: 'How Everyversion checks software: source links, re-computed SHA-256 hashes, code signatures and VirusTotal scans, plus what the checks cannot tell you.',
    body,
  };
}

// ------------------------------------------------------------------ api

const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const API_BASE = 'https://everyversion.net';

// Copy-paste examples. Each one was run against the real files before it went on the page.
const API_EXAMPLES = [
  {
    title: 'Look up one app',
    text: 'The index has one short entry per app. This pulls out VLC’s newest versions and license.',
    code: String.raw`curl -s ${API_BASE}/api/v1/apps.json \
  | jq '.apps[] | select(.slug=="vlc") | {name, latest_versions, license}'`,
  },
  {
    title: 'See what changed lately',
    text: 'Sort by the date of each app’s newest release and print the top five.',
    code: String.raw`curl -s ${API_BASE}/api/v1/apps.json \
  | jq -r '.apps | sort_by(.last_updated) | reverse | .[:5][] | "\(.last_updated)  \(.name)"'`,
  },
  {
    title: 'List a whole category',
    text: 'Every app has a category slug. Here are all the VPN apps.',
    code: String.raw`curl -s ${API_BASE}/api/v1/apps.json \
  | jq -r '.apps[] | select(.category=="vpns") | .name'`,
  },
  {
    title: 'Get an installer link and check it',
    text: 'Read the newest Windows x64 download and its SHA-256 from the app’s own file (the first one listed, if the app ships several formats), download it from the publisher, then compare the hash. On Linux, use sha256sum -c instead of shasum -a 256 -c.',
    code: String.raw`data=$(curl -s ${API_BASE}/vlc/vlc.json)
pick='[.versions[] | select(.platform=="windows")][0] | [.installers[] | select(.architecture=="x64")][0]'
url=$(printf '%s' "$data" | jq -r "$pick | .url")
sha=$(printf '%s' "$data" | jq -r "$pick | .sha256")

curl -LO "$url"
printf '%s  %s\n' "$sha" "$(basename "$url")" | shasum -a 256 -c`,
  },
  {
    title: 'Use it from JavaScript',
    text: 'Runs in Node 18 or newer and in Deno. This counts the open-source apps that run on Windows.',
    code: String.raw`const res = await fetch('${API_BASE}/api/v1/apps.json');
const { apps } = await res.json();

const open = apps.filter((a) => a.pricing === 'open-source' && a.platforms.includes('windows'));
console.log(open.length, 'open-source Windows apps');`,
  },
  {
    title: 'Hand an app to an AI assistant',
    text: 'Every app also has a Markdown page. Paste it into a prompt, or let an agent fetch it.',
    code: String.raw`curl -s ${API_BASE}/vlc/vlc.md`,
  },
];

export function apiPage({ apps, versions, categories, indexKB }) {
  const example = (e, i) => `<div class="ex">
<h3>${escHtml(e.title)}</h3>
<p>${escHtml(e.text)}</p>
<div class="code"><button type="button" class="copy" data-copy="${escHtml(e.code)}" aria-label="Copy example ${i + 1}">Copy</button><pre><code>${escHtml(e.code)}</code></pre></div>
</div>`;
  const body = `
${crumbs([null, 'API'])}
<article class="prose">
<h1>The Everyversion API</h1>
<p class="lead">${fmt(apps)} apps. ${fmt(versions)} versions. Every download link, SHA-256 checksum and license, as plain JSON you can fetch right now. No key, no signup, no price.</p>
<p><a class="btn cta-btn" href="/api/v1/apps.json">Open the index</a></p>

<h2>Who this is for</h2>
<ul class="clean">
<li><strong>You write tools for older machines.</strong> You need to know which version is the newest, which are older, and where each one lives.</li>
<li><strong>You run an AI agent or assistant.</strong> Someone asks “where do I download that old version?” and you want an answer from data, not a guess.</li>
<li><strong>You look after a fleet of PCs.</strong> You want to check every download against its checksum before it reaches anyone.</li>
</ul>

<h2>Why it’s just files</h2>
<p>There is no database or application server behind this. The whole site is built into plain files from one set of data, and the JSON is that same data. So there is no account to create and no key to manage. You fetch a file and you get the facts.</p>

<h2>What each link does</h2>
<div class="scroll"><table>
<thead><tr><th scope="col">Link</th><th scope="col">What you get</th></tr></thead>
<tbody>
<tr><td><a href="/api/v1/apps.json"><code>/api/v1/apps.json</code></a></td><td><strong>The index. Start here.</strong> One short entry per app: name, publisher, summary, platforms, newest version on each platform, license, price label, category, and links to the app’s page and files. About ${indexKB} KB.</td></tr>
<tr><td><code>/{slug}/{slug}.json</code><br>for example <a href="/vlc/vlc.json"><code>/vlc/vlc.json</code></a></td><td><strong>The full record for one app.</strong> Every version we list (up to 100 per platform), and for each version every installer with its architecture, format, download URL, file name and SHA-256. It also holds the source of the data and how far we checked it.</td></tr>
<tr><td><code>/{slug}/{slug}.md</code><br>for example <a href="/vlc/vlc.md"><code>/vlc/vlc.md</code></a></td><td><strong>The same facts as Markdown.</strong> Made for pasting into a prompt or for an agent to read.</td></tr>
<tr><td><a href="/api/v1/categories.json"><code>/api/v1/categories.json</code></a></td><td><strong>The categories.</strong> Each one with its name, app count and the slugs of its apps. Categories with a page on this site also carry the page URL.</td></tr>
<tr><td><a href="/schema/app.schema.json"><code>/schema/app.schema.json</code></a></td><td><strong>The JSON Schema</strong> for the per-app record. Use it to validate what you read.</td></tr>
<tr><td><a href="/llms.txt"><code>/llms.txt</code></a></td><td><strong>A plain-text map for agents:</strong> how the site is organized, how to read the data, and one line for every app.</td></tr>
<tr><td><a href="/sitemap.xml"><code>/sitemap.xml</code></a></td><td>Every page on the site.</td></tr>
</tbody></table></div>

<h2>Try it in 30 seconds</h2>
<p>These examples use <code>curl</code> and <a href="https://jqlang.github.io/jq/">jq</a>, plus one in JavaScript. Each one was run against the live data before it went on this page.</p>
${API_EXAMPLES.map(example).join('\n')}

<h2>What the fields mean</h2>
<ul class="clean">
<li><code>slug</code> is the app’s short name and its address: <code>/{slug}/</code>.</li>
<li><code>platforms</code> is a list drawn from <code>windows</code>, <code>macos</code> and <code>linux</code>. <code>latest_versions</code> gives the newest version on each.</li>
<li><code>last_updated</code> is the date of the newest release in our data (<code>YYYY-MM-DD</code>). Some apps have none, so check for it.</li>
<li><code>pricing</code> is one of <code>open-source</code>, <code>freeware</code>, <code>free-to-download</code>, <code>paid</code> or <code>unknown</code>. “Free to download” is a label we set by hand, and it can still mean paid tiers exist; <code>paid</code> means the software needs a purchase after any free trial.</li>
<li><code>versions_total</code> is how many versions the source has. We list up to 100 per platform. On the Mac side, most sources list only the current release.</li>
<li><code>ids</code> holds the identifiers the app goes by in its source, such as its winget ID, Homebrew cask or Flathub app ID. Not every app has every one.</li>
<li><code>category</code> is the slug of the app’s main category, as listed in <code>categories.json</code>.</li>
</ul>

<h2>Can you trust the checksums?</h2>
<p>You can trust them as far as the file says. Look at <code>verification.level</code> in an app’s file:</p>
<ul class="clean">
<li><strong>Level 0:</strong> the SHA-256 values are copied from the package listing or the publisher’s own checksum files. We have not re-computed them.</li>
<li><strong>Level 1:</strong> we downloaded the installers, re-computed each SHA-256 and compared it. <code>verification.checked_at</code> says when.</li>
</ul>
<p>Two more things. We host no installers, so every <code>url</code> points to the download location named in the publisher’s package data, which we can’t control. And a matching checksum shows a file is the one that was published. It does not show the file is safe. Read the <a href="/security/">Security page</a> for what our checks can and can’t tell you.</p>

<h2>House rules</h2>
<ul class="clean">
<li><strong>Fetch once, then cache.</strong> The files change when we process new data, not every minute. Keeping the index for a day is plenty, and one request at a time is plenty.</li>
<li><strong>Say who you are.</strong> A clear <code>User-Agent</code> helps if I ever need to reach you.</li>
<li><strong>Give credit and respect licenses.</strong> The data comes from public package catalogs and publishers’ own feeds. Link back to the page you used, and follow the license of any software you handle. See <a href="/legal/content/">Content &amp; takedown requests</a>.</li>
<li><strong>Expect new fields.</strong> The <code>v1</code> in the path is there so a breaking change can ship as <code>v2</code>. New fields can appear in <code>v1</code>, so read the ones you need and ignore the rest.</li>
<li><strong>Browsers on other sites.</strong> These files are meant for scripts, servers and agents. Whether a page on another website can read them depends on the server’s CORS settings, which we don’t promise.</li>
<li><strong>No guarantees.</strong> The <a href="/legal/terms/">Terms of Service</a> apply, including the parts about accuracy and availability.</li>
</ul>

<h2>Missing something?</h2>
<p>If you need a field that isn’t there, an app that isn’t listed, or a file in a different shape, tell me. The list grows from requests like yours.</p>
<p><a class="btn" href="/contact/">Write to me</a> <a class="btn-outline" href="/api/v1/apps.json">Or just start with the index</a></p>
</article>
<script>
document.addEventListener('click',(e)=>{const b=e.target.closest('.copy');if(!b)return;const t=b.dataset.copy,done=()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)},fb=()=>{const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{if(document.execCommand('copy'))done()}catch(_){}a.remove()};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(done,fb);else fb()});
</script>`;
  return {
    path: '/api/',
    title: 'Everyversion API – JSON for old software versions, checksums and download links',
    description: `A free JSON API with ${fmt(apps)} apps and ${fmt(versions)} versions: download links, SHA-256 checksums and licenses. No key or signup. Copy-paste examples for curl, jq and JavaScript.`,
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', '@id': 'https://everyversion.net/api/#page', name: 'Everyversion API', url: 'https://everyversion.net/api/', inLanguage: 'en-US', isPartOf: { '@id': 'https://everyversion.net/#website' } },
          { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://everyversion.net/' }, { '@type': 'ListItem', position: 2, name: 'API', item: 'https://everyversion.net/api/' }] },
        ],
      },
    ],
  };
}

// ------------------------------------------------------------------ legal

const LEGAL_DOCS = [
  { path: '/legal/privacy/', label: 'Privacy Policy', blurb: 'What data this site collects (very little) and what it does with it.' },
  { path: '/legal/terms/', label: 'Terms of Service', blurb: 'The rules for using the site and what you can expect from it.' },
  { path: '/legal/cookies/', label: 'Cookie Policy', blurb: 'Which cookies we set. Right now: none.' },
  { path: '/legal/disclaimer/', label: 'Disclaimer & Trademarks', blurb: 'No affiliation with publishers, no warranty on downloads, and how to stay safe with old software.' },
  { path: '/legal/content/', label: 'Content & Takedown Requests', blurb: 'Where our data comes from, and how publishers can ask for a change.' },
];
export const LEGAL_PATHS = LEGAL_DOCS.map((d) => d.path);

const stamp = `<p class="updated">Last updated: <time datetime="${LEGAL_UPDATED}">${LEGAL_UPDATED}</time></p>`;

function legalShell(doc, inner, description) {
  return {
    noindex: true, // legal pages stay out of search results (and out of the sitemap)
    path: doc.path,
    title: `${doc.label} – Everyversion`,
    description,
    body: `
${crumbs(['/legal/', 'Legal'], [null, doc.label])}
<article class="prose">
<h1>${doc.label}</h1>
${stamp}
${inner}
<h2>Who we are</h2>
<p>Everyversion is operated by ${AUTHOR}, ${ADDRESS}.</p>
<p class="pin">Questions about this page? <a href="/contact/">Contact us</a>. Other legal pages: <a href="/legal/">Legal hub</a>.</p>
</article>`,
  };
}

export function legalHub() {
  const body = `
${crumbs([null, 'Legal'])}
<article class="prose">
<h1>Legal</h1>
<p class="lead">The short version: we host no files, we collect almost no data, and we set no cookies. The details are below.</p>
<ul class="legal-list">
${LEGAL_DOCS.map((d) => `<li><a href="${d.path}"><strong>${d.label}</strong><span>${d.blurb}</span></a></li>`).join('\n')}
</ul>
<p>Everyversion is operated by ${AUTHOR}, ${ADDRESS}.</p>
<p class="pin">Last updated: <time datetime="${LEGAL_UPDATED}">${LEGAL_UPDATED}</time> · Need to reach us? <a href="/contact/">Contact</a>.</p>
</article>`;
  return {
    noindex: true,
    path: '/legal/',
    title: 'Legal – Privacy, Terms, Cookies and Disclaimer | Everyversion',
    description: 'Privacy policy, terms of service, cookie policy, disclaimer and takedown requests for Everyversion.',
    body,
  };
}

export function privacyPage() {
  return legalShell(
    LEGAL_DOCS[0],
    `
<h2>The short version</h2>
<p>You don’t need an account. We don’t sell your data, we show no ads, we use no third-party analytics, and we set no cookies. We do count visits with our own small script, without storing your IP address (details below). The only personal data we are likely to hold is what you choose to send us through the contact form, plus the technical logs any web host keeps.</p>

<h2>Who is responsible for your data</h2>
<p>${AUTHOR}, ${ADDRESS}, runs Everyversion (everyversion.net) and decides how the data described here is used. To reach us about your data, use the <a href="${topicLink('privacy')}">contact form</a> and choose “Privacy question”.</p>

<h2>What we collect, why, and on what basis</h2>
<ul class="clean">
<li><strong>Contact-form messages.</strong> Your name, email address, the topic you pick and your message. We use them to answer you and to keep a record of the request. The basis is your request (you chose to write to us) and our legitimate interest in running the site and handling correction and takedown requests properly.</li>
<li><strong>Server logs.</strong> The company that hosts the site may record your IP address, the time, the page requested and your browser type. This is standard for any web host. It is used for security and reliability, on the basis of our legitimate interest in keeping the site working and safe. We don’t use these logs to identify or profile visitors.</li>
<li><strong>A display preference on your own device.</strong> If you use the light/dark button, your choice is saved in your browser’s local storage. It stays on your device and is never sent to us. See the <a href="/legal/cookies/">Cookie Policy</a>.</li>
<li><strong>Anonymous usage statistics.</strong> A small script of our own sends an event to our own server when a page is viewed and when you click a Download, Install or copy-command button. Each event records the page, which button, the app and platform, your country (taken from the network the request passes through), your browser, operating system and device type (kept as short labels, not the full browser string), your browser language, the website that linked to you, and the time. We do not store your IP address and we set no cookie. To count daily visitors we compute a one-way hash of your IP address and browser string with a random salt that is deleted at the end of each day, so the hash can neither be reversed nor followed from one day to the next. The raw events are deleted after 400 days. Totals, with nothing that identifies a visitor, are public on the <a href="/statistics/">Stats</a> page. The script sends nothing if your browser sends Do Not Track or Global Privacy Control, and bots are left out. The basis is our legitimate interest in knowing which software people look for and how the site is used.</li>
<li><strong>Nothing else.</strong> There is no sign-up, no tracking pixel, no third-party analytics service and no advertising network. The search box works inside your browser, so what you type is not sent to us.</li>
</ul>
<p>You are not required to give us any personal data to browse the site. The contact form needs a name and email address so we can reply.</p>

<h2>Who else handles data</h2>
<ul class="clean">
<li><strong>Our web host</strong> serves the pages and keeps the logs described above.</li>
<li><strong>Formspree</strong> (a US service) delivers contact-form submissions to us and processes them on our behalf under its own privacy policy.</li>
<li><strong>Authorities and courts</strong>, when the law requires us to disclose something, or when we need to protect our rights.</li>
</ul>
<p>We don’t sell personal data, and we don’t share it for advertising. Our providers may only use the data to provide their service to us.</p>

<h2>Sites you visit from here</h2>
<p>Many links leave Everyversion. When you click one, your browser connects to another company and its privacy policy applies, not ours. This includes publisher download servers, project pages on GitHub, and the VirusTotal pages linked from app pages. The “For Agents” menu can open ChatGPT or Claude with a short pre-written prompt that asks the assistant to read our <code>llms.txt</code> file. We add nothing about you to that prompt, and what you do next is governed by that service’s terms.</p>

<h2>International transfers</h2>
<p>Our providers may process data in the United States or other countries whose data-protection laws differ from yours. Where the law requires safeguards for such transfers, we rely on the arrangements our providers make available, such as standard contractual clauses.</p>

<h2>How long we keep data</h2>
<p>We keep contact-form messages only as long as we need them to answer you and to keep a sensible record of the request, and we delete them sooner if you ask us to. Server logs are kept by our web host under its own settings.</p>

<h2>Security</h2>
<p>We use reputable providers and sensible safeguards, and we collect very little. No method of storing or sending data is completely secure, so we can’t guarantee absolute security. If a breach affects your personal data, we will tell you and the relevant authorities as the law requires.</p>

<h2>Your rights</h2>
<p>Depending on where you live, you may have the right to:</p>
<ul class="clean">
<li>ask whether we hold personal data about you and get a copy;</li>
<li>have inaccurate data corrected or your data deleted;</li>
<li>restrict or object to certain uses of your data;</li>
<li>receive the data you gave us in a portable format;</li>
<li>withdraw consent where we rely on it; and</li>
<li>complain to your local data-protection authority.</li>
</ul>
<p><strong>California and other US states.</strong> We don’t sell personal information or share it for cross-context behavioral advertising, and we don’t use it to make automated decisions about you. You can ask us to tell you what we hold, correct it or delete it, and we won’t treat you differently for doing so.</p>
<p>To use any of these rights, <a href="${topicLink('privacy')}">send us a privacy request</a> from the email address you used to contact us, so we can match it to our records. We answer within the time the law sets, normally 30 to 45 days. We may need to confirm your identity first, and we may decline requests the law allows us to decline, such as ones that are manifestly unfounded.</p>
<p><strong>Do Not Track and Global Privacy Control.</strong> We don’t track visitors, so there is nothing to opt out of. Browser signals such as Global Privacy Control are honored in the sense that we never share personal data for advertising in the first place.</p>

<h2>Children</h2>
<p>The site is not directed at children under 13, or under the higher age your country sets for consent, and we don’t knowingly collect their data. If you think a child has sent us personal data, tell us and we will delete it.</p>

<h2>Changes</h2>
<p>If this policy changes, we update the date at the top of the page and, for significant changes, say so at the top of the page. Using the site after a change means you accept the updated policy.</p>`,
    'What Everyversion collects (almost nothing), who handles it, how long we keep it, and your privacy rights.',
  );
}

export function termsPage() {
  return legalShell(
    LEGAL_DOCS[1],
    `
<h2>1. Agreement</h2>
<p>These terms are an agreement between you and ${AUTHOR} (“we”, “us”), who runs Everyversion at everyversion.net (the “Site”). By using the Site you accept these terms, our <a href="/legal/privacy/">Privacy Policy</a>, <a href="/legal/cookies/">Cookie Policy</a> and <a href="/legal/disclaimer/">Disclaimer</a>, and the <a href="/legal/content/">Content &amp; Takedown</a> page. If you don’t accept them, please don’t use the Site. If you use the Site for an organization, you confirm you can accept these terms for it. You must be old enough to enter a binding agreement where you live.</p>

<h2>2. What the Site is</h2>
<p>Everyversion is an information index. It lists software versions, links to the download locations named in publishers’ package data, checksums and related facts. <strong>We host no installers and we don’t distribute software.</strong> We are independent, and no publisher listed has endorsed us or is responsible for us. Nothing on the Site is legal, security, technical or professional advice.</p>

<h2>3. Software you download is not ours</h2>
<p>Every download button leads to the publisher’s server. The software, and the license or terms it comes with, are between you and the publisher, and we are not a party to them. Software can contain bugs, security flaws or malicious code, and older versions often contain flaws that later versions fixed. You are responsible for deciding whether to download or run any software, for complying with its license, and for checking a download before you run it.</p>

<h2>4. Information on the Site</h2>
<ul class="clean">
<li><strong>Accuracy.</strong> Our data comes from third-party sources and automated processes. It can be wrong, incomplete or out of date, and a publisher can change or remove a file at any time. We work to keep it correct but don’t promise that it is.</li>
<li><strong>Checks and safety labels.</strong> Checksums, code-signature results, VirusTotal results and labels such as “Safe”, “Medium risk” or “Not scanned” are tools to help you decide. They are not a guarantee, certification or statement of fact that any file is safe or unsafe. Labels are produced by the scoring method described on our <a href="/security/">Security page</a> from results supplied by third parties. Security-vendor labels are shown as those vendors report them, and we don’t verify or endorse them. A clean result does not prove a file is safe, and a flagged result does not prove it is malicious.</li>
<li><strong>Corrections.</strong> If you are a publisher or user and believe something on the Site is wrong, <a href="/contact/">tell us</a>. We review such reports promptly and correct errors we confirm.</li>
</ul>

<h2>5. Acceptable use</h2>
<p>When you use the Site, you agree not to:</p>
<ul class="clean">
<li>break any law or the rights of others;</li>
<li>interfere with or overload the Site, or try to get around its security or access limits;</li>
<li>use the Site to spread malware or to mislead others about the source of a file; or</li>
<li>say or imply that we are affiliated with, or endorsed by, any publisher or product.</li>
</ul>
<p>Reasonable automated use of our public JSON, Markdown and <code>llms.txt</code> files is welcome. We may slow down, limit or block traffic that harms the Site or other users.</p>

<h2>6. Intellectual property</h2>
<p>Product names, logos and trademarks belong to their owners and are used here only to identify the software. Our original text, design and code belong to us. Underlying package data is used under the licenses of its sources. Don’t copy our original content beyond what the law permits or what the <a href="/legal/content/">Content page</a> allows. If you reuse our data, respect the upstream licenses and link back to the page you used.</p>

<h2>7. Copyright complaints</h2>
<p>We host no files, but we do link to them and describe them. If you believe a link or text on the Site infringes your copyright, <a href="${topicLink('publisher')}">send us a notice</a> that includes:</p>
<ul class="clean">
<li>your name, mailing address, email address and phone number, and a physical or electronic signature;</li>
<li>a description of the copyrighted work you say is infringed;</li>
<li>the exact URL of the page or link you want us to review;</li>
<li>a statement that you believe in good faith that the use is not authorized by the copyright owner, its agent or the law; and</li>
<li>a statement, under penalty of perjury, that the information in your notice is accurate and that you are the owner or authorized to act for the owner.</li>
</ul>
<p>We may remove or disable the listing or link in response to a valid notice. If you believe a notice was sent in error, you may send us a counter-notice with the same identifying details, the URL concerned, a statement under penalty of perjury that you believe the material was removed by mistake, and your consent to the courts described in section 13. Knowingly sending a false notice can make you liable for damages.</p>

<h2>8. No warranty</h2>
<p><strong>The Site, its data and all links are provided “as is” and “as available”, without warranties of any kind, express or implied, including any warranty of accuracy, completeness, availability, merchantability, fitness for a particular purpose or non-infringement.</strong> The Site is a free service. We make no promise that it will be uninterrupted, error-free or free of harmful components, or that any linked software will work, stay available or be safe.</p>

<h2>9. Limit of liability</h2>
<p><strong>To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for any loss of data, profits, revenue, business or goodwill, or damage to your devices or systems, arising from or connected with the Site, the information on it, or software you download or run after following a link from it. This applies under any legal theory, including contract, tort (including negligence) and strict liability, even if we have been told such loss is possible.</strong></p>
<p>To the fullest extent the law allows, our total liability to you for all claims connected with the Site will not exceed US$100. The Site is free, and these limits are a basic part of why we can offer it.</p>
<p>Some places don’t allow certain exclusions or limits, and nothing in these terms limits liability that the law does not allow us to limit, such as liability for fraud, or for death or personal injury caused by negligence. In those places our liability is limited to the smallest extent the law allows. Consumers keep any rights that the law of their country gives them and that cannot be waived.</p>

<h2>10. Indemnity</h2>
<p>To the extent the law allows, you will defend and compensate us against claims, losses and reasonable legal costs brought by someone else that arise from your breach of these terms, your unlawful use of the Site, or your use of software in breach of its license.</p>
<p><strong>We do not indemnify, defend or hold harmless you or anyone else against any claim, loss, liability or cost connected with the Site, or with any software, file, listing or link on it.</strong> That includes claims by publishers, licensors or other third parties, and it applies whatever the source of the link is. Listing a link is not a promise about the file it leads to, and we are not a party to any license, warranty or other agreement between you and a publisher.</p>

<h2>11. Availability and changes to the Site</h2>
<p>We may change, suspend or stop any part of the Site, or remove any listing, at any time. We aren’t liable for outages or loss caused by things outside our reasonable control, including failures of hosting, network or other providers, attacks, computer viruses, disasters, war and civil disturbance.</p>

<h2>12. Links and third-party services</h2>
<p>The Site links to publishers and other third parties and uses third-party services such as Formspree for the contact form. We don’t control them and aren’t responsible for their content, availability, terms or practices. Each download link points to the location named in the publisher’s package data, which is normally the publisher’s own server. A server can be changed, redirected or compromised, so we don’t guarantee that any link is official, current, complete or safe.</p>

<h2>13. Governing law and disputes</h2>
<p>These terms are governed by the laws of the State of New York, USA, without regard to its conflict-of-laws rules. Before starting a claim, please <a href="/contact/">contact us</a> and give us 30 days to try to resolve the matter. Subject to any mandatory rights you have where you live, any claim that remains will be brought only in the state or federal courts located in New York, New York, and you and we agree to those courts’ jurisdiction.</p>

<h2>14. Changes to these terms</h2>
<p>We may update these terms. The date at the top of the page shows the latest version, and for significant changes we will say so at the top of the page. If you keep using the Site after a change, you accept the updated terms. If you don’t accept them, stop using the Site.</p>

<h2>15. General</h2>
<p>These terms and the pages they refer to are the whole agreement between you and us about the Site. If a court finds part of them unenforceable, the rest stays in force. If we don’t enforce a right, that isn’t a waiver of it. We may transfer our rights under these terms; you may not transfer yours without our consent. Sections that by their nature should survive (including 3, 4, 6 to 10 and 13) survive if you stop using the Site. Headings are for convenience only.</p>

<h2>16. Contact</h2>
<p>Questions about these terms: <a href="/contact/">contact us</a>.</p>`,
    'The terms for using Everyversion: an index with no hosted files, no warranty, limited liability, and a clear copyright-complaint process.',
  );
}

export function cookiesPage() {
  return legalShell(
    LEGAL_DOCS[2],
    `
<h2>Do we use cookies?</h2>
<p>No. This site sets no cookies of its own, and it loads no third-party analytics, advertising or social-media scripts. We count visits with a small script of our own that stores nothing in your browser and sends events only to our own server (see the <a href="/legal/privacy/">Privacy Policy</a> and the public <a href="/statistics/">Stats</a>). That’s why you see no cookie banner.</p>

<h2>What about local storage?</h2>
<p>One thing, and only if you use it: the light/dark button saves your choice (“light” or “dark”) in your browser’s local storage, so the site remembers it next time. It is not a cookie, it stays on your device, and it is never sent to us. You can clear it in your browser settings. The home-page search and the “Copy” buttons store nothing.</p>

<h2>Other sites</h2>
<p>When you follow a link to a publisher, that site may set its own cookies. Their policy applies there.</p>

<h2>If this changes</h2>
<p>If we ever add anything that needs cookies, we’ll update this page first and ask for consent where the law requires it.</p>`,
    'Everyversion sets no cookies and runs no third-party analytics or advertising scripts.',
  );
}

export function disclaimerPage() {
  return legalShell(
    LEGAL_DOCS[3],
    `
<h2>Not affiliated</h2>
<p>Everyversion is an independent project. It is not affiliated with, endorsed by, or sponsored by any publisher listed. All product names, logos and brands are property of their owners. Using them here only identifies the software.</p>

<h2>We host no installers</h2>
<p>Every download button points to the download location named in the publisher’s package data, normally the publisher’s own server. We can’t see, change or guarantee what is on the other end, and we don’t guarantee that any link is official, current or safe. If a publisher removes or changes a file, the link may stop working or lead somewhere different.</p>

<h2>Checksums are a check, not a guarantee</h2>
<p>A matching SHA-256 tells you the file is the same one that was recorded upstream. It doesn’t prove the file is safe. For most apps our checksums are copied from upstream manifests (we call this verification level 0). For apps marked as checked (level 1) we downloaded the installers ourselves and re-computed the hash, and checked code signatures where our tools could. Each app page shows its status.</p>

<h2>Staying safe with older versions</h2>
<ul class="clean">
<li>Older versions may have known security flaws. Prefer them for offline or low-risk use.</li>
<li>Download only from the publisher link on the page.</li>
<li>Compare the checksum before you run anything.</li>
<li>Be careful with software that talks to the internet or opens files from strangers.</li>
</ul>

<h2>Licenses</h2>
<p>Each app page shows the license the publisher states. Having a link to a version doesn’t give you the right to use it in ways its license forbids.</p>`,
    'Independent from every publisher listed. We host no installers, and a checksum is a check, not a safety guarantee.',
  );
}

export function contentPage() {
  return legalShell(
    LEGAL_DOCS[4],
    `
<h2>Where the data comes from</h2>
<p>Package data is taken from public, openly licensed package catalogs. Each app page names its source, the exact revision we read, and the date we retrieved it, so you can check it yourself.</p>
<p>Facts that the upstream catalog does not provide are left blank. We don’t guess.</p>

<h2>Publishers: ask for a change</h2>
<p>If you publish software listed here and want a link updated, a description corrected, or a listing removed, send a message through the <a href="/contact/">contact page</a> using an address on your company’s domain. Tell us the page URL and what you want changed.</p>
<p><a class="btn" href="${topicLink('publisher')}">Send a request</a></p>
<p>We act on reasonable requests quickly. Because we host no files, removing a listing is usually all that’s needed.</p>

<h2>Copyright concerns</h2>
<p>If you believe something on this site infringes your copyright, use the <a href="/contact/">contact page</a> to send us the URL, a description of the work, and your contact details. We’ll review it and respond.</p>

<h2>Reusing our data</h2>
<p>The JSON and Markdown versions of each page are public so developers can use them. Please respect the upstream licenses, link back to the page you use, and keep your request rate polite.</p>`,
    'Where Everyversion gets its data, and how publishers can request a correction or removal.',
  );
}
