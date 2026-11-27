// Script board — Google Doc sync ("Content Apoorv")
// Every NEW top-level tab you add to this Doc lands in Drafting on the board.
// Tabs inside "Shot & edited" (and that tab itself) are ignored.
//
// Setup: in the Doc → Extensions → Apps Script → replace everything → paste this → Save.
// Choose "setup" in the toolbar → Run → allow access. Done.
// setup() marks all tabs that exist right now as already on the board, so only tabs added later are sent.

const BOARD_URL = "https://scriptboard0.netlify.app/api/sheet";
const TAB = "perf";                 // perf = Performance videos, pbv = PB videos, pbc = PB carousels, li = LinkedIn
const SKIP = ["shot & edited"];     // tab titles to ignore (lowercase)
const MIN_CHARS = 40;               // wait until the tab has at least this much text

const props = PropertiesService.getDocumentProperties();
const getSet = k => new Set(JSON.parse(props.getProperty(k) || "[]"));
const putSet = (k, s) => props.setProperty(k, JSON.stringify([...s]));

function topTabs_() {
  return DocumentApp.getActiveDocument().getTabs()
    .filter(t => t.getType() === DocumentApp.TabType.DOCUMENT_TAB && !SKIP.includes(t.getTitle().trim().toLowerCase()));
}

function syncScripts() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    const doc = DocumentApp.getActiveDocument();
    const known = getSet("known");
    const seen = JSON.parse(props.getProperty("pending") || "{}");
    const send = [];
    for (const t of topTabs_()) {
      const id = t.getId();
      if (known.has(id)) continue;
      const text = t.asDocumentTab().getBody().getText().trim();
      if (text.length < MIN_CHARS) continue;
      const h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text));
      // Send only once the text has stopped changing between two checks, so half-typed scripts aren't posted.
      if (seen[id] !== h) { seen[id] = h; continue; }
      send.push({ id, key: doc.getId() + ":" + id, title: t.getTitle().trim(), script: text });
    }
    for (let i = 0; i < send.length; i += 10) {
      const batch = send.slice(i, i + 10);
      const r = UrlFetchApp.fetch(BOARD_URL, {
        method: "post", contentType: "application/json", muteHttpExceptions: true,
        payload: JSON.stringify({ tab: TAB, rows: batch.map(b => ({ key: b.key, title: b.title, script: b.script })) }),
      });
      if (r.getResponseCode() !== 200) { console.error("Board said " + r.getResponseCode() + ": " + r.getContentText()); break; }
      batch.forEach(b => { known.add(b.id); delete seen[b.id]; });
    }
    putSet("known", known);
    props.setProperty("pending", JSON.stringify(seen));
  } finally { lock.releaseLock(); }
}

function setup() {
  putSet("known", new Set(topTabs_().map(t => t.getId())));
  props.setProperty("pending", "{}");
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncScripts").timeBased().everyMinutes(5).create();
}

// Run this if you want one specific existing tab sent too: put its exact title below, then Run.
function sendOneTab() {
  const title = "PUT TAB TITLE HERE";
  const known = getSet("known");
  const t = topTabs_().find(x => x.getTitle().trim() === title);
  if (!t) throw new Error("No top-level tab called " + title);
  known.delete(t.getId()); putSet("known", known);
  const seen = JSON.parse(props.getProperty("pending") || "{}");
  seen[t.getId()] = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, t.asDocumentTab().getBody().getText().trim()));
  props.setProperty("pending", JSON.stringify(seen));
  syncScripts();
}
