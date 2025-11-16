import { getAccessToken } from "../spotifyAuthorization.js";


const BASE_URL = process.env.REACT_APP_API_BASE_URL;

function joinUrl(path) {
  if (!path) return BASE_URL;
  if (path.startsWith('http')) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function getAuthToken() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  const token = await getAccessToken(code);
  return token;
}

function timeoutFetch(resource, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const finalOptions = { ...options, signal: controller.signal };
  return fetch(resource, finalOptions).finally(() => clearTimeout(id));
}

async function parseResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (res.status === 204) return null;
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

function normalizeError(name, message, status, body) {
  const err = new Error(message);
  err.name = name || 'ApiError';
  if (status) err.status = status;
  if (body) err.body = body;
  return err;
}

async function request(path, { method = 'GET', headers = {}, body, timeout = 10000, raw = false } = {}) {
  const url = joinUrl(path);
  const defaultHeaders = { Accept: 'application/json' };
  const token = await getAuthToken();
  if (token) defaultHeaders['Authorization'] = `Bearer ${token}`;

  let options = { method, headers: { ...defaultHeaders, ...headers } };

  if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  } else if (body instanceof FormData) {
    options.body = body;
    // let browser set Content-Type (including boundary)
  } else if (typeof body === 'string') {
    options.body = body;
  }

  let res;
  try {
    res = await timeoutFetch(url, options, timeout);
  } catch (err) {
    if (err.name === 'AbortError') throw normalizeError('TimeoutError', `Request timed out after ${timeout}ms`);
    throw normalizeError('NetworkError', err.message);
  }

  const textBody = await parseResponse(res).catch(() => null);

  if (!res.ok) {
    throw normalizeError('HttpError', `HTTP ${res.status}`, res.status, textBody);
  }

  return textBody;
}

const api = {
  request,
  get: (path, opts = {}) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts = {}) => request(path, { ...opts, method: 'DELETE' }),
};

export default api;
