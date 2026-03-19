/**
 * Timer Web Worker — mantiene il countdown preciso anche quando
 * iOS/Android mette la tab in background o lo schermo si spegne.
 * window.setInterval viene throttlato dal browser (fino a 1 tick/minuto);
 * il Web Worker non ha questo limite.
 */

let intervalId: ReturnType<typeof setInterval> | null = null;
let secondsLeft = 0;
let running = false;

function stop() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  running = false;
}

function startTicking() {
  if (running) return;
  running = true;
  intervalId = setInterval(() => {
    if (secondsLeft <= 0) {
      stop();
      self.postMessage({ type: 'DONE' });
      return;
    }
    secondsLeft--;
    self.postMessage({ type: 'TICK', secondsLeft });
  }, 1000);
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: string; initialSeconds?: number; seconds?: number };
  switch (msg.type) {
    case 'START':
      stop();
      secondsLeft = msg.initialSeconds ?? 0;
      startTicking();
      break;
    case 'PAUSE':
      stop();
      break;
    case 'RESUME':
      startTicking();
      break;
    case 'RESET':
      stop();
      secondsLeft = msg.seconds ?? 0;
      self.postMessage({ type: 'TICK', secondsLeft });
      break;
  }
};
