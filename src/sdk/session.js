// Created only when telemetry starts, so nothing is written to sessionStorage while it is off.
export function getSessionId() {
  try {
    let id = sessionStorage.getItem('otel.session.id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('otel.session.id', id);
    }
    return id;
  } catch {
    return 'unknown'; // storage blocked
  }
}
