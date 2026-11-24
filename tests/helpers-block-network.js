// Preloaded by the E2E server: only loopback requests may leave the process (no LINE / Drive / slip APIs).
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return Promise.reject(new Error(`[E2E sandbox] blocked outbound request to ${url.hostname}`));
  }
  return realFetch(input, init);
};
