// A call to a model provider: the request goes out with a time limit, and an answer that is late,
// missing or bad becomes a ModelError with the status to send back, never a hidden failure.

export class ModelError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export async function ask(url, options, what) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
  } catch (error) {
    throw new ModelError(error.name === "TimeoutError" ? `${what} took too long to answer` : `Could not reach ${what}: ${error.cause?.code ?? error.message}`);
  }
  if (!response.ok) {
    const detail = await response.json().then((d) => d.error?.message ?? d.error ?? "", () => "");
    throw new ModelError(`${what} answered ${response.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`);
  }
  return response.json();
}
