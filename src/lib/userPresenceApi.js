async function userPresenceRequest(path, options = {}) {
  const response = await fetch(`/api/user-presence/${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'User presence request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

export const userPresenceApi = {
  status: (params = {}) => {
    const query = new URLSearchParams(params);
    return userPresenceRequest(`status${query.toString() ? `?${query}` : ''}`);
  },
  challenge: (payload) => userPresenceRequest('challenge', { method: 'POST', body: JSON.stringify(payload) }),
  enroll: (payload) => userPresenceRequest('enroll', { method: 'POST', body: JSON.stringify(payload) }),
  verify: (payload) => userPresenceRequest('verify', { method: 'POST', body: JSON.stringify(payload) }),
};
