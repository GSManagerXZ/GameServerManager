(() => {
  "use strict";

  class GSM3EasyTierAPI {
    constructor() {
      this.baseURL = "/api/easytier";
      this.channel = new URLSearchParams(window.location.search).get("channel") || "";
      this.token = null;
      this.pendingAuth = new Map();
      this.socket = null;
      this.socketAuthRefresh = null;
      this.boundMessageHandler = this.handleMessage.bind(this);
      window.addEventListener("message", this.boundMessageHandler);
    }

    handleMessage(event) {
      if (
        event.source !== window.parent ||
        event.origin !== window.location.origin ||
        !event.data ||
        event.data.type !== "gsm3-auth-response" ||
        event.data.channel !== this.channel ||
        typeof event.data.requestId !== "string" ||
        typeof event.data.token !== "string"
      ) {
        return;
      }

      const pending = this.pendingAuth.get(event.data.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeoutId);
      this.pendingAuth.delete(event.data.requestId);
      this.token = event.data.token;
      pending.resolve(event.data.token);
    }

    requestAuth() {
      if (this.token) return Promise.resolve(this.token);
      if (window.parent === window || !this.channel) {
        return Promise.reject(new Error("插件必须从 GSM3 插件页面打开"));
      }

      const requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          this.pendingAuth.delete(requestId);
          reject(new Error("等待面板认证超时，请关闭后重试"));
        }, 8000);
        this.pendingAuth.set(requestId, { resolve, reject, timeoutId });
        window.parent.postMessage(
          { type: "gsm3-auth-request", channel: this.channel, requestId },
          window.location.origin,
        );
      });
    }

    async ready() {
      return this.token || this.requestAuth();
    }

    async request(path, options = {}, canRetry = true) {
      const token = await this.ready();
      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Accept", "application/json");

      let body = options.body;
      if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(body);
      }

      const response = await fetch(`${this.baseURL}${path}`, {
        ...options,
        headers,
        body,
      });

      if (response.status === 401 && canRetry) {
        this.token = null;
        const refreshedToken = await this.requestAuth();
        if (this.socket) this.socket.auth = { token: refreshedToken };
        return this.request(path, options, false);
      }

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      if (!response.ok || (payload && payload.success === false)) {
        const error = new Error(payload?.message || `请求失败 (${response.status})`);
        error.status = response.status;
        error.details = payload?.details;
        error.data = payload?.data;
        throw error;
      }
      return payload?.data ?? payload;
    }

    notify(type, message) {
      if (window.parent === window) return;
      window.parent.postMessage(
        { type: "gsm3-notification", channel: this.channel, data: { type, message } },
        window.location.origin,
      );
    }

    closePlugin() {
      if (window.parent === window) return;
      window.parent.postMessage(
        { type: "gsm3-close-plugin", channel: this.channel },
        window.location.origin,
      );
    }

    getProfiles() {
      return this.request("/profiles");
    }

    getInstallation() {
      return this.request("/installation");
    }

    installRecommended(force = false) {
      return this.request("/installation", {
        method: "POST",
        body: { force },
      });
    }

    getWebConsole() {
      return this.request("/web");
    }

    updateWebConsole(settings, restartIfRunning = true) {
      return this.request("/web", {
        method: "PUT",
        body: { settings, restartIfRunning },
      });
    }

    startWebConsole() {
      return this.request("/web/start", { method: "POST" });
    }

    stopWebConsole() {
      return this.request("/web/stop", { method: "POST" });
    }

    restartWebConsole() {
      return this.request("/web/restart", { method: "POST" });
    }

    getProfile(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}`);
    }

    createProfile(profile, secrets = {}) {
      return this.request("/profiles", {
        method: "POST",
        body: { profile, secrets, createInstance: true },
      });
    }

    updateProfile(profileId, profile, secrets = {}) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}`, {
        method: "PUT",
        body: { profile, secrets, createInstance: false },
      });
    }

    deleteProfile(profileId, deleteManagedInstance = true) {
      return this.request(
        `/profiles/${encodeURIComponent(profileId)}?deleteInstance=${deleteManagedInstance ? "true" : "false"}`,
        { method: "DELETE" },
      );
    }

    getInstance(profileId) {
      return this.getProfile(profileId);
    }

    startInstance(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/start`, { method: "POST" });
    }

    stopInstance(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/stop`, { method: "POST" });
    }

    restartInstance(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/restart`, { method: "POST" });
    }

    getCapabilities(profileId, refresh = false) {
      if (refresh) {
        return this.request(`/profiles/${encodeURIComponent(profileId)}/capabilities/refresh`, { method: "POST" });
      }
      return this.getProfile(profileId).then((view) => view.profile?.capabilities || null);
    }

    getSnapshot(profileId, includeRaw = false) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/snapshot${includeRaw ? "?includeRaw=true" : ""}`);
    }

    runAction(profileId, action, payload = {}) {
      const actionPayload = typeof action === "string" ? { type: action, ...payload } : action;
      return this.request(`/profiles/${encodeURIComponent(profileId)}/actions`, {
        method: "POST",
        body: { action: actionPayload },
      });
    }

    getSecurity(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/security`);
    }

    updateSecurity(profileId, input) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/security`, {
        method: "PUT",
        body: input,
      });
    }

    generateStaticKey(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/security/static-key/generate`, {
        method: "POST",
      });
    }

    listCredentials(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/security/credentials`);
    }

    generateCredential(profileId, input) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/security/credentials`, {
        method: "POST",
        body: input,
      });
    }

    revokeCredential(profileId, credentialId) {
      return this.request(
        `/profiles/${encodeURIComponent(profileId)}/security/credentials/${encodeURIComponent(credentialId)}`,
        { method: "DELETE" },
      );
    }

    getAclStats(profileId) {
      return this.request(`/profiles/${encodeURIComponent(profileId)}/security/acl/stats`);
    }

    async connectSocket() {
      if (this.socket?.connected) return this.socket;
      if (typeof window.io !== "function") throw new Error("Socket.IO 客户端未加载");
      const token = await this.ready();
      this.socket = window.io({
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });
      this.socket.io.on("reconnect_attempt", () => {
        if (this.token) this.socket.auth = { token: this.token };
      });
      this.socket.on("connect_error", (error) => {
        if (!/auth|token|jwt|unauthor|认证/i.test(String(error?.message || error || ""))) return;
        if (this.socketAuthRefresh) return;
        this.token = null;
        this.socketAuthRefresh = this.requestAuth()
          .then((refreshedToken) => {
            if (!this.socket) return;
            this.socket.auth = { token: refreshedToken };
            if (!this.socket.connected) this.socket.connect();
          })
          .catch(() => undefined)
          .finally(() => { this.socketAuthRefresh = null; });
      });
      return this.socket;
    }

    async subscribe(profileId, onSnapshot, onError) {
      const socket = await this.connectSocket();
      socket.off("easytier:snapshot");
      socket.off("easytier:error");
      socket.off("connect");
      socket.on("easytier:snapshot", onSnapshot);
      socket.on("easytier:error", onError);
      const emitSubscription = () => socket.emit("easytier:subscribe", { profileId }, (acknowledgement) => {
        if (acknowledgement && acknowledgement.success === false) {
          onError(acknowledgement);
        } else if (acknowledgement?.data) {
          onSnapshot(acknowledgement.data);
        }
      });
      socket.on("connect", emitSubscription);
      if (socket.connected) emitSubscription();
      return () => socket.emit("easytier:unsubscribe", { profileId });
    }
  }

  window.gsm3Api = new GSM3EasyTierAPI();
})();
