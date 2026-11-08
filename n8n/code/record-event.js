// n8n Code node "Record event": remember an eventId AFTER its email was sent, so Convex retries of
// a failed delivery are not mistaken for duplicates. Keeps the newest 500 ids. Runs only on success.
const eventId = $('Compose email').first().json.eventId;
const staticData = $getWorkflowStaticData('global');
const seen = staticData.processedEvents || {};
seen[eventId] = Date.now();
const ids = Object.keys(seen);
if (ids.length > 500) {
  ids.sort((a, b) => seen[a] - seen[b]);
  for (const id of ids.slice(0, ids.length - 500)) delete seen[id];
}
staticData.processedEvents = seen;
return [{ json: { recorded: true } }];
