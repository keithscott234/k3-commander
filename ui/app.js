const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
let busy = false;
async function api(action = 'status') {
  const response = await fetch(`/api/${action}`, {method: action === 'status' ? 'GET' : 'POST',
    headers: {Authorization: `Bearer ${token}`}, cache: 'no-store'});
  if (!response.ok) throw new Error(response.status === 401 ? 'Open this panel again using K3 Commander control.' : 'Action unavailable. Refresh session status.');
  return response.json();
}
function render(s) {
  $('connection').textContent = 'Local connection';
  $('device').textContent = s.device.name;
  $('detail').textContent = `${s.device.platform} · session process ${s.device.pid}`;
  $('mode').textContent = s.mode.replaceAll('_', ' ');
  $('inflight').textContent = s.inFlight;
  $('pause').disabled = busy || s.mode !== 'active';
  $('resume').disabled = busy || s.mode !== 'paused';
  $('stop').disabled = busy || !['active', 'paused'].includes(s.mode);
  $('empty').hidden = s.history.length > 0;
  $('history').replaceChildren(...s.history.map(row => {
    const li = document.createElement('li'), name = document.createElement('strong'), status = document.createElement('span'), time = document.createElement('time');
    name.textContent = row.tool.replaceAll('_', ' '); status.textContent = row.status;
    time.dateTime = row.at; time.textContent = new Date(row.at).toLocaleTimeString();
    li.append(name, status, time); return li;
  }));
}
async function refresh() {
  if (busy) return;
  try { render(await api()); $('message').textContent = ''; }
  catch (error) { $('connection').textContent = 'Disconnected'; $('message').textContent = error.message; for (const id of ['pause','resume','stop']) $(id).disabled = true; }
}
async function act(action) {
  busy = true;
  for (const id of ['pause','resume','stop']) $(id).disabled = true;
  try { const state = await api(action); busy = false; render(state); $('message').textContent = action === 'stop' ? 'Engine stopped. Restart the connected client for a new session.' : ''; }
  catch (error) { $('message').textContent = error.message; }
  finally { busy = false; }
}
$('pause').onclick = () => act('pause');
$('resume').onclick = () => act('resume');
$('stop').onclick = () => $('confirm').showModal();
$('cancel').onclick = () => $('confirm').close();
$('confirm-stop').onclick = () => { $('confirm').close(); void act('stop'); };
void refresh();
setInterval(refresh, 2000);
