import { clearCachedUser } from '@/lib/appApi';

async function faceRequest(path, options = {}) {
  const response = await fetch(`/api/face-verification/${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearCachedUser();
    const error = new Error(data.error || 'Face verification request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export const faceVerificationApi = {
  status: (params = {}) => {
    const query = new URLSearchParams(params);
    return faceRequest(`status${query.toString() ? `?${query}` : ''}`);
  },
  logs: (params = {}) => {
    const query = new URLSearchParams(params);
    return faceRequest(`logs${query.toString() ? `?${query}` : ''}`);
  },
  enroll: (payload) => faceRequest('enroll', { method: 'POST', body: JSON.stringify(payload) }),
  verify: (payload) => faceRequest('verify', { method: 'POST', body: JSON.stringify(payload) }),
  attendance: (payload) => faceRequest('attendance', { method: 'POST', body: JSON.stringify(payload) }),
  suspend: (payload) => faceRequest('suspend', { method: 'POST', body: JSON.stringify(payload) }),
  revoke: (payload) => faceRequest('revoke', { method: 'POST', body: JSON.stringify(payload) }),
  clear: (payload) => faceRequest('clear', { method: 'POST', body: JSON.stringify(payload) }),
  reenroll: (payload) => faceRequest('reenroll', { method: 'POST', body: JSON.stringify(payload) }),
};
