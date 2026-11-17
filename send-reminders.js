// Habsys reminder sender (2.8.0). Runs every 15 minutes in GitHub Actions. Reads the small "reminders" documents from your Firebase project
// and sends ONE push notification per person per day, from their reminder time, when habits are still left today.
// It logs only counts (this repository is public, so the run logs are public too).
'use strict';
const WINDOW_MIN = 120;   // a reminder is still sent up to 2 hours after its time (GitHub can start a run late); after that it is skipped for the day

// Local day ("2026-11-16") and minutes since midnight in the person's own time zone.
function localParts(tz, now) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now)) p[x.type] = x.value;
  return {day: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute)};
}
// Decides what to do with one reminder document. Returns {action: 'skip' | 'mark' | 'send', day, payload?}
function decide(d, now, force) {
  if (!d || d.on !== true || typeof d.sub !== 'string' || !d.sub) return {action: 'skip'};
  let L; try { L = localParts(String(d.tz || 'UTC'), now); } catch (e) { return {action: 'skip'}; }
  const at = Number(d.hour) * 60 + Number(d.min);
  if (!force) {
    if (!(at >= 0 && at < 1440)) return {action: 'skip'};
    if (L.min < at || L.min > at + WINDOW_MIN) return {action: 'skip'};
    if (d.sent === L.day) return {action: 'skip'};
  }
  const known = d.day === L.day && Number.isInteger(d.left);   // the app has reported today's numbers
  if (known && d.left === 0 && !force) return {action: 'mark', day: L.day};   // day complete (or a rest day): nothing to remind
  const body = known && d.left > 0
    ? d.left + ' habit' + (d.left === 1 ? '' : 's') + ' still left today. A small step keeps your chain alive.'
    : 'Have you checked in with your habits today? One small step counts.';
  return {action: 'send', day: L.day, payload: {title: 'Habsys', body: body, left: known ? d.left : 0}};
}

async function main() {
  const admin = require('firebase-admin'), webpush = require('web-push');
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
  webpush.setVapidDetails('https://github.com/' + (process.env.GITHUB_REPOSITORY || 'habsys/habsys'), process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const force = process.env.FORCE === 'true';
  const snap = await admin.firestore().collection('reminders').where('on', '==', true).get();
  const now = new Date(); let sent = 0, marked = 0, failed = 0, removed = 0;
  for (const doc of snap.docs) {
    const r = decide(doc.data(), now, force);
    if (r.action === 'skip') continue;
    try {
      if (r.action === 'send') {
        await webpush.sendNotification(JSON.parse(doc.data().sub), JSON.stringify(r.payload), {TTL: 3 * 3600, urgency: 'normal'});
        sent++;
      } else marked++;
      if (!force) await doc.ref.update({sent: r.day});
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { await doc.ref.update({on: false}); removed++; }   // the iPad no longer accepts pushes (app removed or permission withdrawn)
      else { failed++; console.log('send failed, status', e && e.statusCode); }
    }
  }
  console.log('reminders: ' + snap.size + ' on, ' + sent + ' sent, ' + marked + ' day-complete, ' + removed + ' removed, ' + failed + ' failed' + (force ? ' (forced test run)' : ''));
  if (failed) process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.log('error:', e && e.message); process.exit(1); });
module.exports = {decide, localParts};
