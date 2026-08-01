(() => {
  "use strict";

  window.createEasyTierSecurityUI = (dependencies) => {
    const {
      api,
      byId,
      createElement,
      getContext,
      updateProfileView,
      resetForm,
      setBusy,
      showError,
      announce,
      openModal,
      openConfirm,
      notify,
    } = dependencies;

    let localState = {
      profileId: "",
      security: null,
      credentials: [],
      aclStats: null,
    };

    const setLocalState = (patch) => {
      localState = { ...localState, ...patch };
    };

    const isCurrentProfile = (profileId) => getContext().profileId === profileId;

    const clearSecret = () => {
      byId("credentialSecretValue").textContent = "";
    };

    const reset = (profileId = "") => {
      clearSecret();
      setLocalState({ profileId, security: null, credentials: [], aclStats: null });
      render();
    };

    const load = async (profileId) => {
      if (!profileId) {
        reset();
        return;
      }
      setLocalState({ profileId, security: null, credentials: [], aclStats: null });
      render();
      const security = await api.getSecurity(profileId);
      if (!isCurrentProfile(profileId)) return;
      setLocalState({ security });
      render();
      const context = getContext();
      if (
        security.enabled &&
        security.supportsCredentials &&
        context.instance?.status === "running"
      ) {
        await loadCredentials(false);
      }
    };

    const loadCredentials = async (notifyOnError = true) => {
      const { profileId } = getContext();
      if (!profileId) return;
      try {
        const credentials = await api.listCredentials(profileId);
        if (!isCurrentProfile(profileId)) return;
        setLocalState({ credentials });
        renderCredentials();
      } catch (error) {
        if (notifyOnError) showError(error);
      }
    };

    const setFormDisabled = (selector, disabled) => {
      document.querySelectorAll(selector).forEach((control) => {
        control.disabled = disabled;
      });
    };

    const renderNotice = (security, context) => {
      const notice = byId("securityCapabilityNotice");
      if (!context.profile) {
        notice.textContent = "选择 Profile 后显示 Secure Mode 能力。";
        notice.className = "banner banner-neutral";
        return;
      }
      if (!security) {
        notice.textContent = "正在读取安全能力…";
        notice.className = "banner banner-neutral";
        return;
      }
      if (!security.supportsSecureMode) {
        notice.textContent = "当前 EasyTier 二进制不支持 Secure Mode；请升级后重新检测能力。";
        notice.className = "banner banner-error";
        return;
      }
      if (["running", "starting", "stopping"].includes(context.instance?.status)) {
        notice.textContent = "安全配置为启动时配置。请先停止实例再编辑；临时凭据仍可在运行中管理。";
        notice.className = "banner banner-warning";
        return;
      }
      notice.textContent = "安全配置将写入 Profile；重新启动实例后生效。私钥由服务端加密保存。";
      notice.className = "banner banner-neutral";
    };

    const renderPeerPins = (security) => {
      const container = byId("peerPinsList");
      const peers = security?.peers || [];
      if (peers.length === 0) {
        container.replaceChildren(createElement("p", { className: "empty-state", text: "当前 Profile 没有 Peer。" }));
        return;
      }
      const rows = peers.map((peer) => {
        const row = createElement("div", { className: "peer-pin-row" });
        const identity = document.createElement("div");
        identity.append(
          createElement("strong", { className: "mono", text: peer.uri }),
          createElement("span", { className: "hint", text: "固定 32 字节 X25519 公钥" }),
        );
        const input = document.createElement("input");
        input.className = "mono";
        input.type = "text";
        input.placeholder = "Peer 公钥 base64（可留空）";
        input.value = peer.peerPublicKey || "";
        input.dataset.peerUri = peer.uri;
        input.setAttribute("aria-label", `${peer.uri} 的固定公钥`);
        row.append(identity, input);
        return row;
      });
      container.replaceChildren(...rows);
    };

    const renderAclRules = (security) => {
      const rules = security?.acl || [];
      const rows = rules.map((rule) => {
        const row = document.createElement("tr");
        const identity = document.createElement("td");
        identity.append(
          createElement("strong", { text: rule.id }),
          createElement("div", { className: "hint", text: rule.description || "—" }),
        );
        const action = createElement("td", { text: rule.action === "allow" ? "允许" : "拒绝" });
        const protocol = createElement("td", { text: String(rule.protocol || "any").toUpperCase() });
        const sourceParts = [
          rule.source || "任意 CIDR",
          rule.sourceGroups?.length ? `分组: ${rule.sourceGroups.join(", ")}` : "",
        ].filter(Boolean);
        const destinationParts = [
          rule.destination || "本机",
          rule.destinationGroups?.length ? `分组: ${rule.destinationGroups.join(", ")}` : "",
        ].filter(Boolean);
        const endpoints = createElement("td", {
          className: "mono",
          text: `${sourceParts.join(" · ")} → ${destinationParts.join(" · ")}`,
        });
        const ports = createElement("td", { className: "mono", text: rule.destinationPort || "任意" });
        const actionCell = createElement("td", { className: "align-right" });
        const remove = createElement("button", { className: "button button-danger", text: "删除" });
        remove.type = "button";
        remove.dataset.aclDelete = rule.id;
        actionCell.append(remove);
        row.append(identity, action, protocol, endpoints, ports, actionCell);
        return row;
      });
      byId("aclRulesTableBody").replaceChildren(...rows);
      const defaultAction = security?.aclDefaultAction === "deny" ? "deny" : "allow";
      byId("aclDefaultAction").value = defaultAction;
      byId("aclPolicyHint").textContent = defaultAction === "deny"
        ? "白名单模式：未命中允许规则的入站流量会被拒绝。保存前请确认管理和游戏端口已有允许规则。"
        : "增量限制模式：未命中规则的入站流量保持允许。";
      const empty = byId("aclRulesEmpty");
      empty.hidden = rows.length > 0;
      empty.textContent = defaultAction === "deny"
        ? "当前没有 ACL 规则；所有入站流量都会被拒绝。"
        : "当前没有 ACL 规则；默认允许入站流量。";
      const output = byId("aclStatsOutput");
      output.hidden = !localState.aclStats;
      output.textContent = JSON.stringify(localState.aclStats || {}, null, 2);
    };

    const renderCredentials = () => {
      const rows = localState.credentials.map((credential) => {
        const row = document.createElement("tr");
        const id = createElement("td", { className: "mono", text: credential.id });
        const groups = createElement("td", { text: credential.groups?.join(", ") || "无" });
        const expires = createElement("td", {
          text: credential.expiresAt ? new Date(credential.expiresAt).toLocaleString("zh-CN") : "未知",
        });
        const permissions = createElement("td", {
          text: `${credential.allowRelay ? "可中继" : "禁止中继"} · ${credential.reusable ? "可复用" : "单设备"}`,
        });
        const actionCell = createElement("td", { className: "align-right" });
        const revoke = createElement("button", { className: "button button-danger", text: "撤销" });
        revoke.type = "button";
        revoke.dataset.credentialRevoke = credential.id;
        actionCell.append(revoke);
        row.append(id, groups, expires, permissions, actionCell);
        return row;
      });
      byId("credentialsTableBody").replaceChildren(...rows);
      byId("credentialsEmpty").hidden = rows.length > 0;
    };

    const render = () => {
      const context = getContext();
      const security = localState.profileId === context.profileId ? localState.security : null;
      renderNotice(security, context);
      byId("secureModeStatus").textContent = security?.enabled ? "已启用" : "未启用";
      byId("secureModeStatus").dataset.state = security?.enabled ? "running" : "unknown";
      byId("secureModeEnabled").checked = Boolean(security?.enabled);
      byId("localPublicKey").value = security?.localPublicKey || "";
      renderPeerPins(security);
      renderAclRules(security);
      renderCredentials();

      const status = context.instance?.status || "stopped";
      const canConfigure = Boolean(
        context.profile &&
        security?.supportsSecureMode &&
        !context.isBusy &&
        !["running", "starting", "stopping"].includes(status)
      );
      const canUseCredentials = Boolean(
        security?.enabled &&
        security?.supportsCredentials &&
        status === "running" &&
        !context.isBusy
      );
      const canUseAclStats = Boolean(
        security?.enabled &&
        security?.supportsAcl &&
        status === "running" &&
        !context.isBusy
      );
      setFormDisabled("#secureModeForm input, #secureModeForm button", !canConfigure);
      setFormDisabled("#peerPinsForm input, #peerPinsForm button", !canConfigure);
      setFormDisabled("#aclPolicyForm select, #aclPolicyForm button", !canConfigure);
      setFormDisabled("#aclRuleForm input, #aclRuleForm select, #aclRuleForm button, [data-acl-delete]", !canConfigure);
      setFormDisabled("#credentialForm input, #credentialForm select, #credentialForm button, [data-credential-revoke], #refreshCredentialsButton", !canUseCredentials);
      byId("refreshAclStatsButton").disabled = !canUseAclStats;
      byId("securityWorkspace").classList.toggle("is-disabled", Boolean(context.profile && security && !security.supportsSecureMode));
    };

    const gatherPeerPins = () => (
      [...byId("peerPinsList").querySelectorAll("[data-peer-uri]")].map((input) => ({
        uri: input.dataset.peerUri,
        ...(input.value.trim() ? { peerPublicKey: input.value.trim() } : {}),
      }))
    );

    const saveSecurity = async (patch) => {
      const context = getContext();
      if (!context.profileId || !localState.security) return;
      setBusy(true);
      try {
        const view = await api.updateSecurity(context.profileId, {
          enabled: localState.security.enabled,
          peers: localState.security.peers,
          aclDefaultAction: localState.security.aclDefaultAction,
          acl: localState.security.acl,
          ...patch,
        });
        updateProfileView(view);
        byId("localPrivateKey").value = "";
        await load(context.profileId);
        notify("success", "EasyTier 安全配置已保存");
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    };

    const showCredentialSecret = (result) => {
      byId("credentialSecretValue").textContent = result.secret;
      openModal(byId("credentialSecretModal"));
    };

    const bind = () => {
      byId("secureModeForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const localPrivateKey = byId("localPrivateKey").value.trim();
        saveSecurity({
          enabled: byId("secureModeEnabled").checked,
          ...(localPrivateKey ? { localPrivateKey } : {}),
        });
      });

      byId("generateStaticKeyButton").addEventListener("click", () => {
        const { profileId, profile } = getContext();
        if (!profileId) return;
        openConfirm({
          title: "轮换静态密钥",
          message: `将为“${profile?.name || profileId}”生成新的 X25519 身份。已固定旧公钥的节点需要同步更新。`,
          action: async () => {
            setBusy(true);
            try {
              const result = await api.generateStaticKey(profileId);
              updateProfileView(result.profile);
              await load(profileId);
              notify("success", "静态密钥已生成并加密保存");
            } finally {
              setBusy(false);
            }
          },
        });
      });

      byId("peerPinsForm").addEventListener("submit", (event) => {
        event.preventDefault();
        saveSecurity({ peers: gatherPeerPins() });
      });

      byId("aclPolicyForm").addEventListener("submit", (event) => {
        event.preventDefault();
        saveSecurity({ aclDefaultAction: byId("aclDefaultAction").value });
      });

      byId("aclRuleForm").addEventListener("submit", (event) => {
        event.preventDefault();
        if (!localState.security) return;
        const data = new FormData(event.currentTarget);
        const id = String(data.get("id") || "").trim();
        if (!id) return;
        const nextRule = {
          id,
          action: String(data.get("action")),
          protocol: String(data.get("protocol")),
          sourceGroups: String(data.get("sourceGroups") || "").split(",").map((value) => value.trim()).filter(Boolean),
          destinationGroups: String(data.get("destinationGroups") || "").split(",").map((value) => value.trim()).filter(Boolean),
          ...(String(data.get("source") || "").trim() ? { source: String(data.get("source")).trim() } : {}),
          ...(String(data.get("destination") || "").trim() ? { destination: String(data.get("destination")).trim() } : {}),
          ...(String(data.get("destinationPort") || "").trim()
            ? { destinationPort: String(data.get("destinationPort")).trim() }
            : {}),
          ...(String(data.get("description") || "").trim()
            ? { description: String(data.get("description")).trim() }
            : {}),
        };
        const acl = [...localState.security.acl.filter((rule) => rule.id !== id), nextRule];
        resetForm(event.currentTarget);
        saveSecurity({ acl });
      });

      byId("aclRulesTableBody").addEventListener("click", (event) => {
        const button = event.target.closest("[data-acl-delete]");
        if (!button || !localState.security) return;
        const id = button.dataset.aclDelete;
        openConfirm({
          title: "删除 ACL 规则",
          message: `确定删除规则“${id}”吗？`,
          action: () => saveSecurity({ acl: localState.security.acl.filter((rule) => rule.id !== id) }),
        });
      });

      byId("credentialForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const { profileId } = getContext();
        if (!profileId) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        try {
          const result = await api.generateCredential(profileId, {
            ttlSeconds: Number(data.get("ttlSeconds")),
            groups: String(data.get("groups") || "").split(",").map((value) => value.trim()).filter(Boolean),
            allowedProxyCidrs: String(data.get("allowedProxyCidrs") || "").split(",").map((value) => value.trim()).filter(Boolean),
            allowRelay: data.get("allowRelay") === "on",
            reusable: data.get("reusable") === "on",
          });
          showCredentialSecret(result);
          await loadCredentials(false);
          notify("success", "临时凭据已生成；私钥只显示一次");
        } catch (error) {
          showError(error);
        } finally {
          setBusy(false);
        }
      });

      byId("credentialsTableBody").addEventListener("click", (event) => {
        const button = event.target.closest("[data-credential-revoke]");
        if (!button) return;
        const { profileId } = getContext();
        const credentialId = button.dataset.credentialRevoke;
        openConfirm({
          title: "撤销临时凭据",
          message: `撤销后，使用凭据 ${credentialId} 的节点将失去授权。`,
          action: async () => {
            await api.revokeCredential(profileId, credentialId);
            await loadCredentials(false);
            notify("success", "临时凭据已撤销");
          },
        });
      });

      byId("refreshCredentialsButton").addEventListener("click", () => loadCredentials());
      byId("refreshAclStatsButton").addEventListener("click", async () => {
        const { profileId } = getContext();
        if (!profileId) return;
        try {
          const aclStats = await api.getAclStats(profileId);
          setLocalState({ aclStats });
          renderAclRules(localState.security);
          announce("ACL 命中统计已刷新");
        } catch (error) {
          showError(error);
        }
      });
      byId("copyCredentialSecretButton").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(byId("credentialSecretValue").textContent || "");
          announce("凭据私钥已复制");
        } catch {
          showError(new Error("无法复制凭据私钥，请检查浏览器权限"), false);
        }
      });
    };

    return { bind, load, render, reset, clearSecret };
  };
})();
