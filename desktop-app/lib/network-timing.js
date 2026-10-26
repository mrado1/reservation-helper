'use strict';

// Observe Chromium's network lifecycle. Never retain URLs, request/response
// bodies, cookies, Authorization headers, or verification tokens.
function observeBookingNetwork(webRequest, getViewId, getRunId, onEvent) {
  const requests = new Map();
  const filter = { urls: ['https://api.reserveamerica.com/jaxrs-json/shoppingcart/0/additem*'] };
  const header = (headers, key) => {
    const match = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === key);
    return match ? String(Array.isArray(match[1]) ? match[1][0] : match[1]) : undefined;
  };
  webRequest.onBeforeRequest(filter, (details, callback) => {
    const runId = getRunId();
    if (runId && details.method === 'POST' && details.webContentsId === getViewId()) requests.set(details.id, { runId });
    callback({});
  });
  webRequest.onSendHeaders(filter, details => {
    const request = requests.get(details.id);
    if (request) onEvent({ type: 'sent', id: details.id, runId: request.runId, at: details.timestamp });
  });
  webRequest.onHeadersReceived(filter, (details, callback) => {
    const request = requests.get(details.id);
    if (request) {
      const action = header(details.responseHeaders, 'x-amzn-waf-action');
      request.wafAction = ['challenge', 'captcha'].includes(action) ? action : undefined;
      const retry = header(details.responseHeaders, 'retry-after');
      request.retryAfter = retry && retry.length <= 80 ? retry : undefined;
    }
    callback({});
  });
  const finish = details => {
    const request = requests.get(details.id);
    if (!request) return;
    requests.delete(details.id);
    onEvent({ type: 'complete', id: details.id, runId: request.runId, at: details.timestamp, status: details.statusCode || 0, wafAction: request.wafAction, retryAfter: request.retryAfter });
  };
  webRequest.onCompleted(filter, finish);
  webRequest.onErrorOccurred(filter, finish);
}
module.exports = { observeBookingNetwork };
