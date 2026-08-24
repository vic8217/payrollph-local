// @ts-nocheck
export async function requestJson(path, options = {}) {
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 20000) : null;
  let response;
  try {
    response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
      signal: options.signal || controller?.signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    let message = data?.error || "Request failed";
    if (typeof message === "string" && message.trimStart().startsWith("<!")) {
      message = `Request failed (${response.status} ${response.statusText || ""})`.trim();
    }
    const error = new Error(message);
    error.status = response.status;
    error.code = data?.code;
    error.details = data;
    throw error;
  }

  return data;
}

let cachedUser;

export function clearCachedUser() {
  cachedUser = null;
}

function entityUrl(entity, params = {}) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, key === "filter" ? JSON.stringify(value) : String(value));
    }
  });

  const query = search.toString();
  return `/api/entities/${encodeURIComponent(entity)}${query ? `?${query}` : ""}`;
}

function entityClient(entity) {
  return {
    list(sort, limit, options = {}) {
      return requestJson(entityUrl(entity, { sort, limit, ...options }));
    },
    filter(filter = {}, sort, limit, options = {}) {
      return requestJson(entityUrl(entity, { filter, sort, limit, ...options }));
    },
    page(filter = {}, sort, page = 1, pageSize = 50, options = {}) {
      return requestJson(entityUrl(entity, { filter, sort, page, pageSize, ...options }));
    },
    async allPages(filter = {}, sort, { pageSize = 200, maximum = Number.POSITIVE_INFINITY, ...options } = {}) {
      const records = [];
      for (let page = 1; records.length < maximum; page += 1) {
        const response = await requestJson(entityUrl(entity, { filter, sort, page, pageSize, ...options }));
        records.push(...(response.data || []));
        if (!response.pagination?.hasNextPage) break;
      }
      return records.slice(0, maximum);
    },
    create(data) {
      return requestJson(entityUrl(entity), {
        method: "POST",
        body: JSON.stringify(data || {}),
      });
    },
    update(id, data) {
      return requestJson(entityUrl(entity), {
        method: "PATCH",
        body: JSON.stringify({ id, data: data || {} }),
      });
    },
    delete(id) {
      return requestJson(entityUrl(entity), {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
    },
  };
}

async function uploadFile({ file }) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return requestJson("/api/upload", {
    method: "POST",
    body: JSON.stringify({
      name: file?.name,
      dataUrl,
    }),
  });
}

export const appApi = {
  auth: {
    async me({ force = false } = {}) {
      if (cachedUser && !force) return cachedUser;
      cachedUser = await requestJson("/api/auth/me");
      return cachedUser;
    },
    clearCache: clearCachedUser,
    async touch() {
      return requestJson("/api/auth/touch", { method: "POST" });
    },
    async logout(callbackUrl = "/landing") {
      cachedUser = null;
      try {
        const csrfResponse = await fetch("/api/auth/csrf");
        const { csrfToken } = await csrfResponse.json();
        await fetch("/api/auth/signout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            csrfToken,
            callbackUrl,
            json: "true",
          }),
        });
      } catch {
        // Fall back to the login page even if the session endpoint is unavailable.
      }
      window.location.href = callbackUrl;
    },
    redirectToLogin(callbackUrl = "/landing") {
      window.location.href = callbackUrl;
    },
  },
  entities: new Proxy(
    {},
    {
      get(_target, entity) {
        return entityClient(entity);
      },
    }
  ),
  functions: {
    invoke(name, data) {
      return requestJson(`/api/functions/${encodeURIComponent(name)}`, {
        method: "POST",
        body: JSON.stringify(data || {}),
      });
    },
  },
  integrations: {
    Core: {
      UploadFile: uploadFile,
      InvokeLLM() {
        return Promise.resolve({ response: "" });
      },
      SendEmail() {
        return Promise.resolve({ ok: true });
      },
    },
  },
};
