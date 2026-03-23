const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";
const BASE_URL = API_URL.replace(/\/$/, "");
export const API_CONNECTION_ERROR = "Backend not connected";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export async function apiRequest<T>(
  path: string,
  options: { method?: HttpMethod; token?: string; body?: unknown } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error(API_CONNECTION_ERROR);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export { API_URL };

export async function checkApiHealth() {
  return apiRequest<{ status: string }>("/health");
}