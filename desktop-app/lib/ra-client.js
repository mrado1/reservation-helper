'use strict';

// Runs only inside the trusted Reserve America webview. Credentials never cross
// the IPC bridge to our renderer or enter application logs.
async function requestInPage(request) {
  if (location.origin !== 'https://www.reserveamerica.com') {
    return { ok: false, status: 0, reason: 'page_not_ready', error: 'Open Reserve America in the browser first.' };
  }
  const state = globalThis.__reservationHelperRequests ||= { controllers: new Map(), auth: null, refreshing: null };
  if (request.cancel) {
    for (const [id, controller] of state.controllers) {
      if (id.startsWith(request.cancel)) controller.abort();
    }
    return { ok: true };
  }
  const began = Date.now();
  const controller = new AbortController();
  state.controllers.set(request.id, controller);
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const cookie = name => {
    const raw = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
    if (!raw) return null;
    try { return decodeURIComponent(raw.slice(name.length + 1)); } catch { return null; }
  };
  const fail = (reason, error, status = 0) => Object.assign(new Error(error), { reason, status });
  try {
    const a1 = cookie('a1Data');
    const refreshToken = cookie('ra2Refresh');
    if (!a1 || !refreshToken) throw fail('signed_out', 'Sign in to Reserve America to continue.');
    const expires = state.auth?.expires || 0;
    if (request.prepared && (!state.auth || Date.now() >= expires - 60000 || !state.wafToken || !state.transport || Date.now() >= (state.preparedUntil || 0))) {
      throw fail('preparation_failed', 'Booking preparation expired. Refresh your connection and schedule again.');
    }
    if (!state.auth || Date.now() > expires - 60000 || request.refresh) {
      if (!state.refreshing) {
        state.refreshing = (async () => {
          const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
          if (!csrf) throw fail('page_not_ready', 'Wait for Reserve America to finish loading.');
          const res = await fetch('/refreshAuth', {
            method: 'POST', credentials: 'same-origin', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'CSRF-Token': csrf },
            body: JSON.stringify({ a1Data: JSON.parse(a1), refreshToken })
          });
          if (!res.ok) throw fail(res.status === 401 || res.status === 403 ? 'signed_out' : 'connection_error', 'Could not refresh the Reserve America session.', res.status);
          const data = await res.json();
          if (!data.idToken || !data.a1Data) throw fail('signed_out', 'Your Reserve America session has expired. Sign in again.');
          let exp = Date.now() + 5 * 60000;
          try { exp = JSON.parse(atob(data.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch {}
          state.auth = { idToken: data.idToken, a1Data: data.a1Data, expires: Math.min(exp, Date.now() + 5 * 60000) };
          // Match the website's refresh-token rotation. No password is stored.
          if (data.refreshToken) document.cookie = 'ra2Refresh=' + encodeURIComponent(data.refreshToken) + '; path=/; secure; samesite=lax';
          document.cookie = 'a1Data=' + encodeURIComponent(JSON.stringify(data.a1Data)) + '; path=/; secure; samesite=lax';
        })().finally(() => { state.refreshing = null; });
      }
      await state.refreshing;
    }
    if (controller.signal.aborted) throw new DOMException('Request timed out or was stopped', 'AbortError');
    if (!globalThis.AwsWafIntegration?.fetch) throw fail('verification_required', 'Let Reserve America finish its browser verification, then retry.');
    const sdk = globalThis.AwsWafIntegration;
    let tokenMs = 0;
    if (!request.prepared && (request.prepare || state.transport === 'direct')) {
      const tokenStart = Date.now();
      if (typeof sdk.getToken !== 'function') {
        if (request.prepare) throw fail('verification_required', 'Reserve America verification is not ready. Reload the page.');
      } else {
        state.wafToken = await sdk.getToken();
        tokenMs = Date.now() - tokenStart;
        if (!state.wafToken) throw fail('verification_required', 'Complete Reserve America browser verification before scheduling.');
      }
    }
    if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const options = {
      method: request.method, signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: state.auth.idToken, a1data: JSON.stringify(state.auth.a1Data) },
      ...(request.body ? { body: JSON.stringify(request.body) } : {})
    };
    const url = 'https://api.reserveamerica.com/jaxrs-json/shoppingcart/0' + request.path;
    const send = direct => direct
      ? fetch(url, { ...options, headers: { ...options.headers, 'x-aws-waf-token': state.wafToken } })
      : sdk.fetch(url, options);
    let response;
    let transport = state.transport || 'sdk';
    // Only read-only preparation may compare/fall back. Never duplicate a POST,
    // change transports mid-burst, or switch paths in response to rate limiting.
    if (request.prepare) {
      state.preparedUntil = 0;
      try {
        response = await send(true);
        if (response.status === 200) {
          const probe = await response.clone().json();
          if (!Array.isArray(probe.contractViewList)) throw Error('Unexpected cart shape');
          transport = 'direct';
        } else if (response.status !== 429) {
          response = await send(false); transport = 'sdk';
        }
      } catch (error) {
        if (controller.signal.aborted) throw error;
        response = await send(false); transport = 'sdk';
      }
    } else {
      response = await send(transport === 'direct');
    }
    if (response.status === 405 || response.status === 202) throw fail('verification_required', 'Reserve America needs browser verification. Complete it in the browser, then retry.', response.status);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { throw fail('unexpected_response', 'Reserve America returned an unexpected response. Reload the page and retry.', response.status); }
    if (response.status === 401 || response.status === 403) { state.auth = null; state.preparedUntil = 0; }
    if (request.prepare && response.ok && Array.isArray(body?.contractViewList)) {
      state.transport = transport;
      state.preparedUntil = Math.min(state.auth.expires - 60000, Date.now() + 180000);
    }
    return { ok: response.ok, status: response.status, body, retryAfter: response.headers.get('retry-after'), timing: { transport, tokenMs, totalMs: Date.now() - began, preparedUntil: request.prepare ? state.preparedUntil : undefined } };
  } catch (error) {
    return { ok: false, status: error.status || 0, reason: error.reason || (error.name === 'AbortError' ? 'timeout' : 'connection_error'), error: error.reason ? error.message : error.name === 'AbortError' ? 'Request timed out or was stopped.' : 'Could not reach Reserve America. Check your connection and retry.' };
  } finally {
    clearTimeout(timer);
    state.controllers.delete(request.id);
  }
}

function createRaClient(getWebContents, { timeoutMs = 12000 } = {}) {
  let sequence = 0;
  const request = async (path = '', { method = 'GET', body, signal, group = 'auth', refresh = false, prepare = false, prepared = false } = {}) => {
    const view = getWebContents();
    if (!view || view.isDestroyed() || !view.getURL().startsWith('https://www.reserveamerica.com/')) {
      return { ok: false, status: 0, reason: 'page_not_ready', error: 'Open Reserve America and sign in.' };
    }
    // WebContents.executeJavaScript waits for load completion; a slow page
    // resource must not delay authentication, cancellation, or opening time.
    const frame = view.mainFrame;
    const id = `${group}:${++sequence}`;
    let timer;
    let abort;
    try {
      if (signal?.aborted) return { ok: false, status: 0, reason: 'cancelled' };
      const cancelled = new Promise(resolve => {
        abort = () => {
          frame.executeJavaScript(`globalThis.__reservationHelperDispatchV10?.(${JSON.stringify({ cancel: id })})`).catch(() => {});
          resolve({ ok: false, status: 0, reason: 'cancelled' });
        };
        signal?.addEventListener('abort', abort, { once: true });
      });
      const timeout = new Promise(resolve => { timer = setTimeout(() => { resolve({ ok: false, status: 0, reason: 'timeout', error: 'Reserve America did not respond in time.' }); abort(); }, timeoutMs + 1000); });
      return await Promise.race([
        frame.executeJavaScript(prepared
          ? `globalThis.__reservationHelperDispatchV10 ? globalThis.__reservationHelperDispatchV10(${JSON.stringify({ id, path, method, body, timeoutMs, prepared })}) : ({ok:false,status:0,reason:"preparation_failed",error:"The page changed after booking preparation. Schedule again."})`
          : `(globalThis.__reservationHelperDispatchV10 = ${requestInPage})(${JSON.stringify({ id, path, method, body, timeoutMs, refresh, prepare })})`), cancelled, timeout
      ]);
    } catch {
      return { ok: false, status: 0, reason: 'page_not_ready', error: 'Reserve America changed pages. Wait for it to load and retry.' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  return { prepare: options => request('', { ...options, refresh: true, prepare: true }), cart: options => request('', options), add: (body, options) => request('/additem', { ...options, method: 'POST', body }) };
}
module.exports = { createRaClient, requestInPage };
