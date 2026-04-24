const crypto = require('crypto');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 5000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const DEPLOY_HOST = process.env.DEPLOY_HOST || '172.17.0.1';
const DEPLOY_USER = process.env.DEPLOY_USER || 'openclaw';
const DEPLOY_KEY = process.env.DEPLOY_KEY || '/app/deploy_key';

// APP_MAP: JSON string mapping repo URLs to dokku app names
// Format: {"git@github.com:user/repo.git":"appname", ...}
// Also supports matching by repo full_name: {"user/repo":"appname"}
const APP_MAP = JSON.parse(process.env.APP_MAP || '{}');

function verifySignature(payload, signature) {
    if (!SECRET) return true;
    var hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(payload);
    var expected = 'sha256=' + hmac.digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
    catch { return false; }
}

function dokku(cmd) {
    var escaped = cmd.replace(/"/g, '\\"');
    var sshCmd = [
        'ssh',
        '-i', DEPLOY_KEY,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        DEPLOY_USER + '@' + DEPLOY_HOST,
        '"sudo ' + escaped + '"'
    ].join(' ');
    return execSync(sshCmd, { timeout: 300000, encoding: 'utf8' });
}

function resolveApp(repo) {
    // Try exact match on clone_url or ssh_url
    if (APP_MAP[repo]) return APP_MAP[repo];
    // Try matching by full_name (owner/repo)
    return null;
}

async function deploy(appName, repoUrl) {
    var log = [];
    try {
        log.push('git:sync ' + appName + ' from ' + repoUrl);
        // Always use SSH URL for git:sync
        var sshUrl = repoUrl;
        if (repoUrl.startsWith('https://')) {
            sshUrl = repoUrl.replace('https://github.com/', 'git@github.com:');
        }
        var out = dokku('dokku git:sync ' + appName + ' ' + sshUrl + ' --build');
        log.push('OK ' + out.trim().split('\n').pop());
        return { ok: true, log: log };
    } catch (err) {
        var msg = (err.stderr || err.stdout || err.message || '').toString();
        log.push('FAIL ' + msg.slice(0, 500));
        return { ok: false, log: log };
    }
}

const express = require('express');
const app = express();
app.use(express.json());

app.get('/', function(req, res) {
    res.json({ service: 'git-deploy', apps: APP_MAP, status: 'running' });
});

function handleWebhook(req, res) {
    var sig = req.headers['x-hub-signature-256'] || '';
    var event = req.headers['x-github-event'] || '';

    if (SECRET && !verifySignature(JSON.stringify(req.body), sig)) {
        return res.status(403).json({ error: 'Invalid signature' });
    }
    if (event !== 'push') return res.json({ ok: true, ignored: event });

    var payload = req.body;
    var branch = (payload.ref || '').replace('refs/heads/', '');
    var pusher = payload.pusher ? payload.pusher.name : 'unknown';
    var commits = payload.commits ? payload.commits.length : 0;
    var fullRepoName = (payload.repository || {}).full_name || '';
    var cloneUrl = (payload.repository || {}).clone_url || '';
    var sshUrl = (payload.repository || {}).ssh_url || '';

    console.log('[' + new Date().toISOString() + '] Push to ' + fullRepoName + ' (' + branch + ') by ' + pusher);

    // Resolve app name from repo
    var appName = resolveApp(cloneUrl) || resolveApp(sshUrl) || resolveApp(fullRepoName);

    if (!appName) {
        console.log('[' + new Date().toISOString() + '] No app mapped for ' + fullRepoName + ' — skipping');
        return res.json({ ok: true, ignored: true, message: 'No app mapped for this repo' });
    }

    console.log('[' + new Date().toISOString() + '] Deploying ' + appName + '...');

    res.json({ ok: true, message: 'Deploying ' + appName + ' (' + branch + ')...' });

    var repoUrl = sshUrl || cloneUrl;
    deploy(appName, repoUrl).then(function(result) {
        if (result.ok) {
            console.log('[' + new Date().toISOString() + '] ' + appName + ' SUCCESS');
        } else {
            console.log('[' + new Date().toISOString() + '] ' + appName + ' FAILED');
            result.log.forEach(function(line) { console.log('  > ' + line); });
        }
    });
}

app.post('/webhook', handleWebhook);
app.post('/', handleWebhook);

app.listen(PORT, function() {
    console.log('Git webhook on port ' + PORT);
    console.log('Apps: ' + JSON.stringify(APP_MAP));
    console.log('Deploy via SSH to ' + DEPLOY_USER + '@' + DEPLOY_HOST);
});
