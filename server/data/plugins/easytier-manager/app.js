(() => {
  "use strict";

  const api = window.gsm3Api;
  const byId = (id) => document.getElementById(id);
  const views = {
    overview: ["NETWORK OVERVIEW", "网络概览"],
    profiles: ["CONFIGURATION", "Profiles"],
    web: ["SELF-HOSTED CONSOLE", "Web 控制台"],
    topology: ["LIVE TOPOLOGY", "拓扑与节点"],
    routes: ["ROUTING TABLE", "路由"],
    actions: ["RUNTIME RPC", "运行时操作"],
    security: ["ZERO TRUST", "Secure Mode"],
    diagnostics: ["DIAGNOSTICS", "诊断"],
  };
  const statusLabels = {
    unknown: "未知",
    stopped: "已停止",
    starting: "启动中",
    running: "运行中",
    stopping: "停止中",
    error: "异常",
  };
  const capabilityLabels = {
    supportsConfigFile: "配置文件",
    supportsJsonOutput: "JSON 输出",
    supportsSecureMode: "Secure Mode",
    supportsCredentials: "临时凭据",
    supportsAcl: "ACL",
  };

  let state = {
    profiles: [],
    selectedProfileId: "",
    snapshot: null,
    capabilities: null,
    installation: null,
    webStatus: null,
    activeView: "overview",
    unsubscribe: null,
    isBusy: false,
    confirmAction: null,
  };
  let activeModal = null;
  let securityUI = null;

  const setState = (patch) => {
    state = { ...state, ...patch };
  };

  const currentView = () => state.profiles.find((item) => item.profile?.id === state.selectedProfileId) || null;
  const currentProfile = () => currentView()?.profile || null;
  const currentInstance = () => currentView()?.instance || null;

  const createElement = (tag, options = {}) => {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = String(options.text);
    if (options.title) element.title = options.title;
    return element;
  };

  const resetForm = (form) => {
    if (typeof form.reset === "function") {
      form.reset();
      return;
    }
    form.querySelectorAll("input, select, textarea").forEach((control) => {
      const type = String(control.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        control.checked = typeof control.defaultChecked === "boolean"
          ? control.defaultChecked
          : control.hasAttribute("checked");
        return;
      }
      if (control.tagName === "SELECT") {
        const options = [...control.options];
        const defaultOption = options.find((option) => option.defaultSelected || option.hasAttribute("selected"));
        control.value = defaultOption?.value || options[0]?.value || "";
        return;
      }
      control.value = typeof control.defaultValue === "string" ? control.defaultValue : "";
    });
  };

  const announce = (message) => {
    byId("announcement").textContent = message;
  };

  const describeError = (error) => {
    if (error instanceof Error && error.message) return error.message;
    return "操作失败，请稍后重试";
  };

  const showError = (error, notify = true) => {
    const message = describeError(error);
    const banner = byId("errorBanner");
    banner.textContent = message;
    banner.hidden = false;
    announce(message);
    if (notify) api.notify("error", message);
  };

  const clearError = () => {
    const banner = byId("errorBanner");
    banner.hidden = true;
    banner.textContent = "";
  };

  const setBusy = (isBusy) => {
    setState({ isBusy });
    document.body.setAttribute("aria-busy", String(isBusy));
    document.querySelectorAll("button[data-runtime-control]").forEach((button) => {
      button.disabled = isBusy;
    });
    renderControls();
    renderWebStatus();
    securityUI?.render();
  };

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const normalized = value / (1024 ** unitIndex);
    return `${normalized.toFixed(normalized >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const setView = (viewName) => {
    if (!Object.prototype.hasOwnProperty.call(views, viewName)) return;
    setState({ activeView: viewName });
    document.querySelectorAll("[data-view]").forEach((section) => {
      const isActive = section.dataset.view === viewName;
      section.hidden = !isActive;
      section.classList.toggle("is-active", isActive);
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      const isActive = button.dataset.viewTarget === viewName;
      button.classList.toggle("is-active", isActive);
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    byId("activeViewEyebrow").textContent = views[viewName][0];
    byId("activeViewTitle").textContent = views[viewName][1];
  };

  const renderProfileSelect = () => {
    const select = byId("profileSelect");
    const options = state.profiles.map((item) => {
      const option = createElement("option", { text: item.profile.name });
      option.value = item.profile.id;
      return option;
    });
    if (options.length === 0) {
      const option = createElement("option", { text: "尚未创建 Profile" });
      option.value = "";
      options.push(option);
    }
    select.replaceChildren(...options);
    select.value = state.selectedProfileId;
    select.disabled = state.profiles.length === 0;
  };

  const makeStatusPill = (status) => {
    const pill = createElement("span", { className: "status-pill", text: statusLabels[status] || status || "未知" });
    pill.dataset.state = status || "unknown";
    return pill;
  };

  const makeRowButton = (label, action, profileId, className = "button button-quiet") => {
    const button = createElement("button", { className, text: label });
    button.type = "button";
    button.dataset.profileAction = action;
    button.dataset.profileId = profileId;
    return button;
  };

  const renderProfilesTable = () => {
    const body = byId("profilesTableBody");
    const rows = state.profiles.map((item) => {
      const profile = item.profile;
      const row = document.createElement("tr");
      const profileCell = document.createElement("td");
      const name = createElement("strong", { text: profile.name });
      const migrationLabel = profile.migration?.source === "tunnel-helper" ? " · 已迁移" : "";
      const detail = createElement("div", {
        className: "hint",
        text: `${profile.settings?.hostname || profile.id}${migrationLabel}`,
      });
      profileCell.append(name, detail);
      const networkCell = createElement("td", { text: profile.networkName });
      const statusCell = document.createElement("td");
      statusCell.append(makeStatusPill(item.instance?.status || "stopped"));
      const versionCell = createElement("td", { className: "mono", text: profile.capabilities?.version || "未检测" });
      const actionCell = createElement("td", { className: "align-right" });
      const actions = createElement("div", { className: "row-actions" });
      actions.append(
        makeRowButton("选择", "select", profile.id),
        makeRowButton("编辑", "edit", profile.id),
        makeRowButton("删除", "delete", profile.id, "button button-danger"),
      );
      actionCell.append(actions);
      row.append(profileCell, networkCell, statusCell, versionCell, actionCell);
      return row;
    });
    body.replaceChildren(...rows);
    byId("profilesEmpty").hidden = rows.length > 0;
  };

  const renderSummary = () => {
    const profile = currentProfile();
    const details = byId("profileSummary").querySelectorAll("dd");
    const values = profile
      ? [
          profile.name,
          profile.networkName,
          profile.capabilities?.version || "未检测",
          profile.settings?.rpcPortal || "自动分配",
        ]
      : ["—", "—", "—", "—"];
    details.forEach((detail, index) => { detail.textContent = values[index]; });
  };

  const renderCapabilities = () => {
    const capabilities = state.capabilities || currentProfile()?.capabilities || null;
    const container = byId("capabilityList");
    if (!capabilities) {
      container.replaceChildren(createElement("p", { className: "empty-state", text: "尚未完成能力检测" }));
      return;
    }
    const items = Object.entries(capabilityLabels).map(([key, label]) => {
      const item = createElement("span", { className: "capability-item", text: label });
      item.classList.toggle("is-supported", Boolean(capabilities[key]));
      return item;
    });
    container.replaceChildren(...items);
  };

  const renderSnapshot = () => {
    const snapshot = state.snapshot;
    const node = snapshot?.node || {};
    const traffic = snapshot?.traffic || {};
    byId("metricIpv4").textContent = node.virtualIpv4 || "—";
    byId("metricHostname").textContent = node.hostname || "等待节点信息";
    byId("metricPeers").textContent = String(snapshot?.peers?.length || 0);
    byId("metricDirectPeers").textContent = `${snapshot?.peers?.filter((peer) => peer.direct).length || 0} 个直连`;
    byId("metricRx").textContent = formatBytes(traffic.rxBytes);
    byId("metricTx").textContent = formatBytes(traffic.txBytes);
    byId("metricNat").textContent = node.natType ? `NAT ${node.natType}` : "NAT 未知";
    byId("snapshotFreshness").textContent = snapshot?.capturedAt
      ? `更新于 ${new Date(snapshot.capturedAt).toLocaleTimeString("zh-CN")}`
      : "尚无快照";

    renderPeers(snapshot?.peers || []);
    renderRoutes(snapshot?.routes || []);
    renderDiagnostics(snapshot);
  };

  const renderPeers = (peers) => {
    const rows = peers.map((peer) => {
      const row = document.createElement("tr");
      const cells = [
        peer.hostname || peer.id,
        peer.virtualIpv4 || "—",
        Number.isFinite(peer.latencyMs) ? `${peer.latencyMs} ms` : "—",
        peer.natType || "—",
        peer.tunnelProtocol || "—",
        peer.direct ? "直连" : "中继",
      ].map((value) => createElement("td", { text: value }));
      row.append(...cells);
      return row;
    });
    byId("peersTableBody").replaceChildren(...rows);
    byId("peersEmpty").hidden = rows.length > 0;
  };

  const renderRoutes = (routes) => {
    const rows = routes.map((route) => {
      const row = document.createElement("tr");
      const cells = [
        route.destination,
        route.nextHop || "—",
        route.interface || "—",
        route.metric ?? "—",
        route.proxy ? "代理" : "直达",
      ].map((value) => createElement("td", { text: value }));
      row.append(...cells);
      return row;
    });
    byId("routesTableBody").replaceChildren(...rows);
    byId("routesEmpty").hidden = rows.length > 0;
  };

  const renderDiagnostics = (snapshot = state.snapshot) => {
    const capabilities = state.capabilities || currentProfile()?.capabilities || {};
    const warnings = [
      ...(capabilities.compatibilityWarnings || []),
      ...(snapshot?.warnings || []),
      ...(snapshot?.error ? [snapshot.error] : []),
    ];
    const listItems = (warnings.length > 0 ? warnings : ["当前未发现兼容性提醒。"])
      .map((warning) => createElement("li", { text: warning }));
    byId("diagnosticWarnings").replaceChildren(...listItems);
    byId("rawSnapshot").textContent = JSON.stringify(snapshot || {}, null, 2);
    const warningBanner = byId("warningBanner");
    warningBanner.hidden = warnings.length === 0;
    warningBanner.textContent = warnings.length > 0 ? warnings[0] : "";
  };

  const renderControls = () => {
    const profile = currentProfile();
    const status = currentInstance()?.status || state.snapshot?.state || "stopped";
    const hasProfile = Boolean(profile);
    const statusPill = byId("instanceStatus");
    statusPill.textContent = hasProfile ? (statusLabels[status] || status) : "未选择";
    statusPill.dataset.state = hasProfile ? status : "unknown";
    byId("startButton").disabled = state.isBusy || !hasProfile || ["running", "starting", "stopping"].includes(status);
    byId("stopButton").disabled = state.isBusy || !hasProfile || ["stopped", "stopping", "starting"].includes(status);
    byId("restartButton").disabled = state.isBusy || !hasProfile || ["starting", "stopping"].includes(status);
    byId("editCurrentProfileButton").disabled = !hasProfile;
    byId("refreshCapabilitiesButton").disabled = state.isBusy || !hasProfile;

    const supportsActions = status === "running" && Boolean((state.capabilities || profile?.capabilities)?.supportsJsonOutput);
    document.querySelectorAll(".action-form input, .action-form select, .action-form button").forEach((control) => {
      control.disabled = state.isBusy || !supportsActions;
    });
  };

  const renderInstallation = () => {
    const status = state.installation;
    const installation = status?.installation || null;
    byId("installVersion").textContent = status?.recommendedVersion || "—";
    byId("installTarget").textContent = status
      ? `${status.platform}/${status.architecture}${status.artifactName ? ` · ${status.artifactName}` : ""}`
      : "—";
    byId("installDirectory").textContent = installation?.directory || "尚未安装";
    const stateTag = byId("installState");
    stateTag.textContent = installation ? `已安装 ${installation.version}` : status?.supported ? "可安装" : "不支持";
    const installButton = byId("installEasyTierButton");
    installButton.disabled = state.isBusy || !status?.supported;
    installButton.dataset.force = installation ? "true" : "false";
    installButton.textContent = installation ? "重新安装推荐版本" : "安装推荐版本";
    installButton.title = status?.unsupportedReason || "";
  };

  const renderWebStatus = () => {
    const web = state.webStatus;
    const instanceStatus = web?.instance?.status || "stopped";
    const statusPill = byId("webServiceStatus");
    statusPill.textContent = web?.configured ? (statusLabels[instanceStatus] || instanceStatus) : "未配置";
    statusPill.dataset.state = web?.configured ? instanceStatus : "unknown";
    byId("webServiceDescription").textContent = web
      ? `${web.version ? `EasyTier Web ${web.version}` : "EasyTier Web 程序未就绪"} · ${web.healthy ? "API 已响应" : "API 未响应"}`
      : "正在读取服务状态…";
    byId("webHealthTag").textContent = web?.healthy ? "API 正常" : instanceStatus === "running" ? "等待 API" : "未运行";
    byId("webConnectionUri").value = web?.configServerUri || "udp://127.0.0.1:22020/<用户名>";
    byId("webDatabasePath").textContent = web?.databasePath || "—";
    byId("webLogsDirectory").textContent = web?.logsDirectory || "—";

    const openButton = byId("webOpenButton");
    if (web?.managementUrl) {
      openButton.href = web.managementUrl;
      openButton.setAttribute("aria-disabled", "false");
      openButton.title = `打开 ${web.managementUrl}`;
    } else {
      openButton.removeAttribute("href");
      openButton.setAttribute("aria-disabled", "true");
      openButton.title = "请先保存 API Host";
    }

    const canManage = Boolean(web?.configured && web?.binaryAvailable);
    byId("webStartButton").disabled = state.isBusy || !canManage || ["running", "starting", "stopping"].includes(instanceStatus);
    byId("webStopButton").disabled = state.isBusy || !canManage || ["stopped", "stopping", "starting"].includes(instanceStatus);
    byId("webRestartButton").disabled = state.isBusy || !canManage || ["starting", "stopping"].includes(instanceStatus);
    document.querySelectorAll("#webSettingsForm input, #webSettingsForm select, #webSettingsForm button").forEach((control) => {
      control.disabled = state.isBusy;
    });

    const warnings = web?.warnings || [];
    byId("webWarnings").replaceChildren(...warnings.map((warning) => createElement("li", { text: warning })));
    byId("webWarningPanel").hidden = warnings.length === 0;
  };

  const populateWebForm = () => {
    const settings = state.webStatus?.settings;
    if (!settings) return;
    byId("webBinaryPath").value = settings.binaryPath || state.installation?.installation?.webEmbedPath || "easytier-web-embed";
    const apiServerAddress = settings.apiServerAddress || "127.0.0.1";
    byId("webApiServerAddress").value = apiServerAddress;
    byId("webApiServerPort").value = String(settings.apiServerPort || 11211);
    const apiHostName = apiServerAddress.includes(":") ? `[${apiServerAddress}]` : apiServerAddress;
    byId("webApiHost").value = settings.apiHost || `http://${apiHostName}:${settings.apiServerPort || 11211}`;
    byId("webConfigServerProtocol").value = settings.configServerProtocol || "udp";
    byId("webConfigServerPort").value = String(settings.configServerPort || 22020);
    byId("webAutoStart").checked = Boolean(settings.autoStart);
    byId("webDisableRegistration").checked = Boolean(settings.disableRegistration);
    byId("webAllowAutoCreateUser").checked = Boolean(settings.allowAutoCreateUser);
  };

  const renderAll = () => {
    renderProfileSelect();
    renderProfilesTable();
    renderSummary();
    renderCapabilities();
    renderSnapshot();
    renderControls();
    renderInstallation();
    renderWebStatus();
    securityUI?.render();
  };

  const updateViewInState = (nextView) => {
    const profiles = state.profiles.map((item) => item.profile.id === nextView.profile.id ? nextView : item);
    setState({ profiles });
  };

  const updateProfileAndSnapshot = (result) => {
    const existingView = currentView();
    if (existingView && result?.profile) {
      updateViewInState({ ...existingView, profile: result.profile });
      setState({ capabilities: result.profile.capabilities || state.capabilities });
    }
    if (result?.snapshot) setState({ snapshot: result.snapshot });
    renderAll();
  };

  const loadProfiles = async (preferredProfileId = state.selectedProfileId) => {
    clearError();
    const profiles = await api.getProfiles();
    const selectedProfileId = profiles.some((item) => item.profile.id === preferredProfileId)
      ? preferredProfileId
      : profiles[0]?.profile.id || "";
    setState({ profiles, selectedProfileId });
    if (!selectedProfileId) securityUI?.reset();
    renderAll();
    if (selectedProfileId) await selectProfile(selectedProfileId, false);
  };

  const loadWebConsole = async (populateForm = true) => {
    const [installation, webStatus] = await Promise.all([
      api.getInstallation(),
      api.getWebConsole(),
    ]);
    setState({ installation, webStatus });
    renderInstallation();
    renderWebStatus();
    if (populateForm) populateWebForm();
  };

  const selectProfile = async (profileId, refreshList = true) => {
    if (!profileId) return;
    clearError();
    if (state.unsubscribe) state.unsubscribe();
    setState({ selectedProfileId: profileId, snapshot: null, capabilities: null, unsubscribe: null });
    securityUI?.reset(profileId);
    renderAll();

    try {
      const [viewResult, capabilityResult, snapshotResult] = await Promise.allSettled([
        api.getProfile(profileId),
        api.getCapabilities(profileId),
        api.getSnapshot(profileId),
      ]);
      if (state.selectedProfileId !== profileId) return;
      if (viewResult.status === "fulfilled") updateViewInState(viewResult.value);
      if (capabilityResult.status === "fulfilled") setState({ capabilities: capabilityResult.value });
      if (snapshotResult.status === "fulfilled") setState({ snapshot: snapshotResult.value });
      renderAll();
      securityUI?.load(profileId).catch((error) => showError(error, false));

      const unsubscribe = await api.subscribe(
        profileId,
        (snapshot) => {
          if (state.selectedProfileId !== profileId) return;
          setState({ snapshot });
          const view = currentView();
          if (view?.instance && snapshot?.state && view.instance.status !== snapshot.state) {
            updateViewInState({
              ...view,
              instance: { ...view.instance, status: snapshot.state },
            });
          }
          renderAll();
        },
        (error) => {
          if (state.selectedProfileId === profileId) showError(error, false);
        },
      );
      if (state.selectedProfileId === profileId) setState({ unsubscribe });
      else unsubscribe();
      if (refreshList && viewResult.status !== "fulfilled") await loadProfiles(profileId);
    } catch (error) {
      showError(error);
    }
  };

  const runLifecycle = async (operation) => {
    const profileId = state.selectedProfileId;
    if (!profileId || state.isBusy) return;
    setBusy(true);
    clearError();
    try {
      const handlers = {
        start: () => api.startInstance(profileId),
        stop: () => api.stopInstance(profileId),
        restart: () => api.restartInstance(profileId),
      };
      const nextView = await handlers[operation]();
      updateViewInState(nextView);
      renderAll();
      const label = operation === "start" ? "启动" : operation === "stop" ? "停止" : "重启";
      api.notify("success", `${currentProfile()?.name || "EasyTier"} ${label}请求已完成`);
      announce(`${label}操作完成`);
      window.setTimeout(() => selectProfile(profileId, false), 500);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const installEasyTier = async () => {
    if (state.isBusy) return;
    setBusy(true);
    clearError();
    try {
      const force = byId("installEasyTierButton").dataset.force === "true";
      const result = await api.installRecommended(force);
      setState({ installation: result.installation, webStatus: result.web });
      populateWebForm();
      renderInstallation();
      renderWebStatus();
      api.notify("success", `EasyTier ${result.installation?.installation?.version || "推荐版本"} 已安装`);
      announce("EasyTier 推荐版本安装完成");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const saveWebSettings = async (event) => {
    event.preventDefault();
    if (state.isBusy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const errorElement = byId("webSettingsError");
    if (!form.checkValidity()) {
      errorElement.textContent = "请检查 EasyTier Web 必填项、URL 与端口格式。";
      errorElement.hidden = false;
      form.reportValidity();
      return;
    }
    const settings = {
      binaryPath: String(data.get("binaryPath") || "").trim(),
      apiServerAddress: String(data.get("apiServerAddress") || "").trim(),
      apiServerPort: Number(data.get("apiServerPort")),
      apiHost: String(data.get("apiHost") || "").trim(),
      configServerProtocol: String(data.get("configServerProtocol") || "udp"),
      configServerPort: Number(data.get("configServerPort")),
      autoStart: data.get("autoStart") === "on",
      disableRegistration: data.get("disableRegistration") === "on",
      allowAutoCreateUser: data.get("allowAutoCreateUser") === "on",
    };

    errorElement.hidden = true;
    setBusy(true);
    clearError();
    try {
      const webStatus = await api.updateWebConsole(settings, true);
      setState({ webStatus });
      populateWebForm();
      renderWebStatus();
      api.notify("success", "EasyTier Web 配置已保存并应用");
      announce("EasyTier Web 配置已保存");
    } catch (error) {
      errorElement.textContent = describeError(error);
      errorElement.hidden = false;
    } finally {
      setBusy(false);
    }
  };

  const runWebLifecycle = async (operation) => {
    if (state.isBusy) return;
    setBusy(true);
    clearError();
    try {
      const handlers = {
        start: () => api.startWebConsole(),
        stop: () => api.stopWebConsole(),
        restart: () => api.restartWebConsole(),
      };
      const webStatus = await handlers[operation]();
      setState({ webStatus });
      renderWebStatus();
      const label = operation === "start" ? "启动" : operation === "stop" ? "停止" : "重启";
      api.notify("success", `EasyTier Web ${label}操作已完成`);
      announce(`EasyTier Web ${label}操作已完成`);
      window.setTimeout(() => loadWebConsole(false).catch((error) => showError(error, false)), 800);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const openModal = (modal) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.querySelector(".app-shell")?.setAttribute("inert", "");
    document.body.classList.add("modal-open");
    modal.hidden = false;
    activeModal = { modal, previousFocus };
    window.requestAnimationFrame(() => {
      modal.classList.add("is-visible");
      modal.querySelector("input:not([type='hidden']), button, select, textarea")?.focus();
    });
  };

  const closeModal = (modal) => {
    modal.classList.remove("is-visible");
    modal.querySelectorAll('input[type="password"]').forEach((input) => {
      input.value = "";
    });
    const previousFocus = activeModal?.modal === modal ? activeModal.previousFocus : null;
    if (activeModal?.modal === modal) activeModal = null;
    window.setTimeout(() => {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      document.querySelector(".app-shell")?.removeAttribute("inert");
      previousFocus?.focus();
    }, 160);
  };

  const openProfileModal = (profileId = "") => {
    const profile = state.profiles.find((item) => item.profile.id === profileId)?.profile || null;
    const form = byId("profileForm");
    resetForm(form);
    byId("profileFormError").hidden = true;
    byId("profileModalTitle").textContent = profile ? "编辑 Profile" : "新建 Profile";
    byId("profileId").value = profile?.id || "";
    byId("profileName").value = profile?.name || "";
    byId("profilePreset").value = profile?.preset || "game-node";
    byId("networkName").value = profile?.networkName || "";
    byId("hostname").value = profile?.settings?.hostname || "";
    byId("corePath").value = profile?.binary?.corePath || state.installation?.installation?.corePath || "easytier-core";
    byId("cliPath").value = profile?.binary?.cliPath || state.installation?.installation?.cliPath || "";
    byId("networkSecret").value = "";
    byId("networkSecret").required = !profile;
    byId("peerUris").value = (profile?.settings?.peers || []).map((peer) => peer.uri).join("\n");
    byId("autoStart").checked = Boolean(profile?.autoStart);
    openModal(byId("profileModal"));
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = String(data.get("id") || "");
    const existing = state.profiles.find((item) => item.profile.id === id)?.profile || null;
    const requiredFields = [
      ["name", "Profile 名称"],
      ["networkName", "网络名称"],
      ["hostname", "节点主机名"],
      ["corePath", "easytier-core 路径"],
    ];
    const missingFields = requiredFields
      .filter(([key]) => !String(data.get(key) || "").trim())
      .map(([, label]) => label);
    const errorElement = byId("profileFormError");
    if (missingFields.length > 0) {
      errorElement.textContent = `请填写：${missingFields.join("、")}。`;
      errorElement.hidden = false;
      return;
    }

    const peers = String(data.get("peerUris") || "")
      .split(/\r?\n/)
      .map((uri) => uri.trim())
      .filter(Boolean)
      .map((uri) => existing?.settings?.peers?.find((peer) => peer.uri === uri) || { uri });
    const binary = {
      corePath: String(data.get("corePath")).trim(),
      ...(String(data.get("cliPath") || "").trim() ? { cliPath: String(data.get("cliPath")).trim() } : {}),
    };
    const profile = existing
      ? {
          ...existing,
          name: String(data.get("name")).trim(),
          preset: String(data.get("preset")),
          networkName: String(data.get("networkName")).trim(),
          autoStart: data.get("autoStart") === "on",
          binary,
          settings: { ...existing.settings, hostname: String(data.get("hostname")).trim(), peers },
        }
      : {
          name: String(data.get("name")).trim(),
          description: "",
          preset: String(data.get("preset")),
          networkName: String(data.get("networkName")).trim(),
          autoStart: data.get("autoStart") === "on",
          binary,
          settings: { hostname: String(data.get("hostname")).trim(), peers },
        };
    const networkSecret = String(data.get("networkSecret") || "");
    if (!existing && !networkSecret) {
      errorElement.textContent = "新建 Profile 时必须提供网络密钥。";
      errorElement.hidden = false;
      return;
    }
    const secrets = networkSecret ? { networkSecret } : {};

    errorElement.hidden = true;
    setBusy(true);
    try {
      const savedView = existing
        ? await api.updateProfile(existing.id, profile, secrets)
        : await api.createProfile(profile, secrets);
      closeModal(byId("profileModal"));
      api.notify("success", `Profile ${savedView.profile.name} 已保存`);
      await loadProfiles(savedView.profile.id);
    } catch (error) {
      errorElement.textContent = describeError(error);
      errorElement.hidden = false;
    } finally {
      setBusy(false);
    }
  };

  const openConfirm = ({ title, message, action, showDeleteInstance = false }) => {
    byId("confirmTitle").textContent = title;
    byId("confirmMessage").textContent = message;
    byId("deleteInstanceRow").hidden = !showDeleteInstance;
    byId("deleteManagedInstance").checked = true;
    setState({ confirmAction: action });
    openModal(byId("confirmModal"));
    byId("cancelConfirmButton").focus();
  };

  const deleteProfile = (profileId) => {
    const profile = state.profiles.find((item) => item.profile.id === profileId)?.profile;
    if (!profile) return;
    openConfirm({
      title: "删除 Profile",
      message: `将永久删除“${profile.name}”的配置。此操作不可撤销。`,
      showDeleteInstance: true,
      action: async () => {
        await api.deleteProfile(profileId, byId("deleteManagedInstance").checked);
        api.notify("success", `Profile ${profile.name} 已删除`);
        await loadProfiles("");
      },
    });
  };

  const runRuntimeAction = async (action) => {
    const profileId = state.selectedProfileId;
    if (!profileId || state.isBusy) return;
    setBusy(true);
    clearError();
    try {
      const result = await api.runAction(profileId, action);
      updateProfileAndSnapshot(result);
      api.notify("success", "EasyTier 运行时配置已更新");
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const bindRuntimeForms = () => {
    ["connectorForm", "mappedListenerForm"].forEach((formId) => {
      byId(formId).addEventListener("submit", (event) => {
        event.preventDefault();
        const prefix = formId === "connectorForm" ? "connector" : "mapped-listener";
        const operation = event.submitter?.dataset.action || "add";
        const uri = String(new FormData(event.currentTarget).get("uri") || "").trim();
        if (uri) runRuntimeAction({ type: `${prefix}-${operation}`, uri });
      });
    });

    byId("portForwardForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const operation = event.submitter?.dataset.action || "add";
      const id = String(data.get("id") || "").trim();
      if (!id) return;
      if (operation === "remove") runRuntimeAction({ type: "port-forward-remove", id });
      else runRuntimeAction({
        type: "port-forward-add",
        value: {
          id,
          proto: String(data.get("proto")),
          bindAddr: String(data.get("bindAddr") || "").trim(),
          dstAddr: String(data.get("dstAddr") || "").trim(),
        },
      });
    });

    byId("whitelistForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const protocol = String(data.get("protocol"));
      const values = String(data.get("values") || "").split(",").map((value) => value.trim()).filter(Boolean);
      runRuntimeAction({ type: `${protocol}-whitelist-set`, values });
    });

    byId("loggerForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const level = String(new FormData(event.currentTarget).get("level") || "info");
      runRuntimeAction({ type: "logger-set", value: { console: { level } } });
    });
  };

  const bindEvents = () => {
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.viewTarget));
    });
    byId("profileSelect").addEventListener("change", (event) => selectProfile(event.target.value));
    byId("createProfileButton").addEventListener("click", () => openProfileModal());
    byId("createProfileSecondaryButton").addEventListener("click", () => openProfileModal());
    byId("editCurrentProfileButton").addEventListener("click", () => openProfileModal(state.selectedProfileId));
    byId("profileForm").addEventListener("submit", saveProfile);
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => {
        const modal = button.closest(".modal-backdrop");
        if (!(modal instanceof HTMLElement)) return;
        if (modal === byId("credentialSecretModal")) securityUI?.clearSecret();
        closeModal(modal);
      });
    });
    byId("startButton").dataset.runtimeControl = "true";
    byId("stopButton").dataset.runtimeControl = "true";
    byId("restartButton").dataset.runtimeControl = "true";
    byId("startButton").addEventListener("click", () => runLifecycle("start"));
    byId("stopButton").addEventListener("click", () => runLifecycle("stop"));
    byId("restartButton").addEventListener("click", () => runLifecycle("restart"));
    byId("refreshButton").addEventListener("click", () => Promise.all([
      loadProfiles(state.selectedProfileId),
      loadWebConsole(false),
    ]).catch(showError));
    byId("webRefreshButton").addEventListener("click", () => loadWebConsole(true).catch(showError));
    byId("installEasyTierButton").addEventListener("click", installEasyTier);
    byId("webSettingsForm").addEventListener("submit", saveWebSettings);
    byId("webStartButton").addEventListener("click", () => runWebLifecycle("start"));
    byId("webStopButton").addEventListener("click", () => runWebLifecycle("stop"));
    byId("webRestartButton").addEventListener("click", () => runWebLifecycle("restart"));
    byId("webOpenButton").addEventListener("click", (event) => {
      if (event.currentTarget.getAttribute("aria-disabled") === "true") event.preventDefault();
    });
    byId("copyWebConnectionButton").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(byId("webConnectionUri").value);
        announce("Core 配置服务器 URI 已复制");
        api.notify("success", "Core 配置服务器 URI 已复制");
      } catch {
        showError(new Error("无法复制连接 URI，请检查浏览器权限"), false);
      }
    });
    byId("refreshCapabilitiesButton").addEventListener("click", async () => {
      if (!state.selectedProfileId) return;
      setBusy(true);
      try {
        const capabilities = await api.getCapabilities(state.selectedProfileId, true);
        setState({ capabilities });
        await loadProfiles(state.selectedProfileId);
        announce("能力检测已刷新");
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });
    byId("profilesTableBody").addEventListener("click", (event) => {
      const button = event.target.closest("[data-profile-action]");
      if (!button) return;
      const profileId = button.dataset.profileId;
      if (button.dataset.profileAction === "select") selectProfile(profileId);
      if (button.dataset.profileAction === "edit") openProfileModal(profileId);
      if (button.dataset.profileAction === "delete") deleteProfile(profileId);
    });
    byId("cancelConfirmButton").addEventListener("click", () => closeModal(byId("confirmModal")));
    byId("acceptConfirmButton").addEventListener("click", async () => {
      const action = state.confirmAction;
      if (!action) return;
      byId("acceptConfirmButton").disabled = true;
      try {
        await action();
        closeModal(byId("confirmModal"));
        setState({ confirmAction: null });
      } catch (error) {
        showError(error);
      } finally {
        byId("acceptConfirmButton").disabled = false;
      }
    });
    byId("copyDiagnosticsButton").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(byId("rawSnapshot").textContent || "{}");
        announce("诊断信息已复制");
        api.notify("success", "诊断信息已复制");
      } catch (error) {
        showError(new Error("无法复制诊断信息，请检查浏览器权限"), false);
      }
    });
    bindRuntimeForms();

    document.addEventListener("keydown", (event) => {
      if (!activeModal) {
        if (event.key === "Escape") api.closePlugin();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeModal.modal === byId("credentialSecretModal")) securityUI?.clearSecret();
        if (activeModal.modal === byId("confirmModal")) closeModal(byId("confirmModal"));
        else closeModal(activeModal.modal);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...activeModal.modal.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  };

  const initialize = async () => {
    securityUI = window.createEasyTierSecurityUI({
      api,
      byId,
      createElement,
      getContext: () => ({
        profileId: state.selectedProfileId,
        profile: currentProfile(),
        instance: currentInstance(),
        capabilities: state.capabilities || currentProfile()?.capabilities || null,
        isBusy: state.isBusy,
      }),
      updateProfileView: (view) => {
        updateViewInState(view);
        setState({ capabilities: view.profile?.capabilities || state.capabilities });
        renderAll();
      },
      resetForm,
      setBusy,
      showError,
      announce,
      openModal,
      openConfirm,
      notify: (type, message) => api.notify(type, message),
    });
    bindEvents();
    const requestedView = new URLSearchParams(window.location.search).get("view");
    if (requestedView && Object.prototype.hasOwnProperty.call(views, requestedView)) setView(requestedView);
    securityUI.bind();
    renderAll();
    try {
      await api.ready();
      byId("bridgeHealthDot").classList.add("is-online");
      byId("bridgeHealthText").textContent = "已连接 GSM3 面板";
      await Promise.all([loadProfiles(), loadWebConsole(true)]);
      api.notify("success", "EasyTier 管理控制台已就绪");
    } catch (error) {
      byId("bridgeHealthText").textContent = "面板认证失败";
      showError(error, false);
    }
  };

  initialize();
})();
