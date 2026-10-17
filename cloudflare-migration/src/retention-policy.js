export const EVENT_RETENTION_DAYS = 14;
export const REPLY_RETENTION_HOURS = 24;
export const MAX_EVENT_AGE_MS = EVENT_RETENTION_DAYS * 86400000;
// Signed LINE redeliveries retain the original event timestamp. Once a durable
// delivered record expires, an old event must not run a mutation again.
export const expiredEvent = (event, now = Date.now()) =>
 typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) && event.timestamp < now - MAX_EVENT_AGE_MS;
