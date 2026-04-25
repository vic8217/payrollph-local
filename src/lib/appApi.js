// @ts-nocheck
export async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error || "Request failed");
    error.status = response.status;
    throw error;
  }

  return data;
}

let cachedUser;

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
    list(sort, limit) {
      return requestJson(entityUrl(entity, { sort, limit }));
    },
    filter(filter = {}, sort, limit) {
      return requestJson(entityUrl(entity, { filter, sort, limit }));
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
    async me() {
      if (cachedUser) return cachedUser;
      cachedUser = await requestJson("/api/auth/me");
      return cachedUser;
    },
    logout(callbackUrl = "/landing") {
      cachedUser = null;
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
