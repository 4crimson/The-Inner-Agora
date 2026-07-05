export class PaperclipApiError extends Error {
  constructor({ method, path, status, body }) {
    super(`${method} ${path} failed: ${status} ${body}`);
    this.name = "PaperclipApiError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

export class PaperclipClient {
  constructor({ apiBase, fetchImpl = fetch }) {
    this.apiBase = String(apiBase || "http://127.0.0.1:3100/api").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async request(method, pathname, body) {
    const response = await this.fetchImpl(`${this.apiBase}${pathname}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new PaperclipApiError({ method, path: pathname, status: response.status, body: text });
    }
    return data;
  }

  async getCompanies() {
    return this.request("GET", "/companies");
  }

  async findCompanyByName(name) {
    const companies = await this.getCompanies();
    return companies.find((company) => company.name === name && company.status !== "archived") || null;
  }

  async listIssues(companyId) {
    return this.request("GET", `/companies/${companyId}/issues`);
  }

  async getIssue(issueId) {
    return this.request("GET", `/issues/${issueId}`);
  }

  async listIssueRuns(issueId) {
    return this.request("GET", `/issues/${issueId}/live-runs`);
  }

  async cancelHeartbeatRun(runId) {
    return this.request("POST", `/heartbeat-runs/${runId}/cancel`, {});
  }

  async deleteIssue(issueId) {
    return this.request("DELETE", `/issues/${issueId}`);
  }

  async patchIssue(issueId, body) {
    return this.request("PATCH", `/issues/${issueId}`, body);
  }
}
