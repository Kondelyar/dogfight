// node scripts/ws-probe.ts <ws-url> <room> - заходить у кімнату й чекає, чим закінчиться з'єднання.
// Друкує, що отримав (welcome, shutdown) і код закриття. Потрібен для verify-image.sh,
// тому не імпортує нічого з проєкту: працює на голому Node з глобальним WebSocket.
const [url, room] = process.argv.slice(2);
if (!url || !room) throw new Error('usage: ws-probe.ts <ws-url> <room>');

const socket = new WebSocket(url);

socket.onopen = () => {
  socket.send(JSON.stringify({ v: 1, type: 'join', room, name: 'probe' }));
};
socket.onmessage = (event: MessageEvent<unknown>) => {
  if (typeof event.data !== 'string') return;
  const msg: unknown = JSON.parse(event.data);
  if (typeof msg === 'object' && msg !== null && 'type' in msg) {
    if (msg.type === 'welcome' || msg.type === 'shutdown') console.log(`got ${String(msg.type)}`);
  }
};
socket.onclose = (event: CloseEvent) => {
  console.log(`close ${event.code}`);
  process.exit(0);
};
socket.onerror = () => {
  console.log('error');
  process.exit(1);
};
setTimeout(() => {
  console.log('timeout');
  process.exit(2);
}, 20_000);
