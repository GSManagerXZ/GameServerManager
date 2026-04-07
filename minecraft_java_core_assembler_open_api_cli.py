#!/usr/bin/env python3
"""我的世界 Java 核心在线组装开放接口交互式参考脚本。"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request


TOOL_KEY = "minecraft-java-core-assembler"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_USER_AGENT = "tools-web-openapi-demo/1.0"
RESOURCE_SITE_URL = "https://rs.xiaozhuhouses.asia/modules/minecraft"
TERMINAL_STATUSES = {"SUCCESS", "FAILED", "CANCELLED"}


class OpenApiError(Exception):
    """开放接口调用异常。"""


@dataclass
class ClientConfig:
    base_url: str = DEFAULT_BASE_URL
    user_agent: str = DEFAULT_USER_AGENT
    timeout_seconds: float = 30.0
    poll_interval_seconds: float = 2.0
    poll_timeout_seconds: float = 900.0


@dataclass
class TaskSession:
    request_id: str
    access_token: str


def print_info(message: str) -> None:
    print(f"[信息] {message}")


def print_warn(message: str) -> None:
    print(f"[警告] {message}")


def print_error(message: str) -> None:
    print(f"[错误] {message}")


def parse_json_bytes(raw_bytes: bytes) -> Any:
    text = raw_bytes.decode("utf-8", errors="replace")
    return json.loads(text)


def build_headers(config: ClientConfig, extra_headers: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": config.user_agent,
    }
    if extra_headers:
        headers.update(extra_headers)
    return headers


def send_json_request(
    config: ClientConfig,
    url: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, Any, dict[str, str]]:
    body = None
    headers = build_headers(config, extra_headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url=url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=config.timeout_seconds) as response:
            raw_bytes = response.read()
            data = parse_json_bytes(raw_bytes) if raw_bytes else None
            return response.status, data, dict(response.headers.items())
    except error.HTTPError as exc:
        raw_bytes = exc.read()
        try:
            payload_data = parse_json_bytes(raw_bytes) if raw_bytes else None
        except json.JSONDecodeError:
            payload_data = raw_bytes.decode("utf-8", errors="replace")
        return exc.code, payload_data, dict(exc.headers.items())
    except error.URLError as exc:
        raise OpenApiError(f"网络请求失败：{exc.reason}") from exc


def ensure_json_object(status_code: int, payload: Any, action_name: str) -> dict[str, Any]:
    if status_code >= 400:
        raise OpenApiError(f"{action_name}失败，HTTP {status_code}，响应：{payload}")
    if not isinstance(payload, dict):
        raise OpenApiError(f"{action_name}返回了非 JSON 对象：{payload!r}")
    return payload


def get_catalog(config: ClientConfig, core_type: str | None = None) -> dict[str, Any]:
    url = f"{config.base_url.rstrip('/')}/api/tools/{TOOL_KEY}/catalog"
    if core_type:
        url += f"?coreType={parse.quote(core_type)}"
    status_code, payload, _ = send_json_request(config, url)
    return ensure_json_object(status_code, payload, "查询目录")


def submit_build_task(
    config: ClientConfig,
    core_type: str,
    version: str,
    mc_version: str,
) -> tuple[dict[str, Any], TaskSession]:
    payload = {
        "params": {
            "coreType": core_type,
            "version": version,
            "mcVersion": mc_version,
        }
    }
    url = f"{config.base_url.rstrip('/')}/api/open/tools/{TOOL_KEY}/execute"
    status_code, response_payload, _ = send_json_request(config, url, method="POST", payload=payload)
    data = ensure_json_object(status_code, response_payload, "提交组装任务")
    request_id = str(data.get("requestId", "")).strip()
    access_token = str(data.get("accessToken", "")).strip()
    if not request_id or not access_token:
        raise OpenApiError(f"提交组装任务成功，但缺少 requestId 或 accessToken：{data}")
    return data, TaskSession(request_id=request_id, access_token=access_token)


def poll_task(config: ClientConfig, session: TaskSession) -> dict[str, Any]:
    url = f"{config.base_url.rstrip('/')}/api/open/tools/{TOOL_KEY}/tasks/{parse.quote(session.request_id)}"
    deadline = time.time() + config.poll_timeout_seconds

    while time.time() < deadline:
        status_code, payload, _ = send_json_request(
            config,
            url,
            extra_headers={"X-Task-Access-Token": session.access_token},
        )
        data = ensure_json_object(status_code, payload, "轮询任务状态")
        status = str(data.get("status", "")).upper()
        queue_position = data.get("queuePosition")
        queue_ahead_count = data.get("queueAheadCount")
        if queue_position is not None and queue_ahead_count is not None:
            print_info(
                f"任务状态：{status}，排队位置：{queue_position}，前方数量：{queue_ahead_count}"
            )
        else:
            print_info(f"任务状态：{status}")
        if status in TERMINAL_STATUSES:
            return data
        time.sleep(config.poll_interval_seconds)

    raise OpenApiError(f"任务在 {config.poll_timeout_seconds:.0f} 秒内未进入终态")


def print_catalog_core_types(config: ClientConfig) -> None:
    data = get_catalog(config)
    core_types = data.get("coreTypes")
    if not isinstance(core_types, list):
        raise OpenApiError(f"目录接口未返回 coreTypes：{data}")
    print_info(f"当前可用核心类型共 {len(core_types)} 个")
    for index, item in enumerate(core_types, start=1):
        print(f"{index:>2}. {item}")


def print_catalog_versions(config: ClientConfig) -> None:
    core_type = read_input("请输入核心类型", default="paper").strip().lower()
    data = get_catalog(config, core_type)
    versions = data.get("versions")
    if not isinstance(versions, list):
        raise OpenApiError(f"目录接口未返回 versions：{data}")
    print_info(f"{core_type} 当前可用版本共 {len(versions)} 个")
    preview_limit = 120
    for index, item in enumerate(versions[:preview_limit], start=1):
        print(f"{index:>3}. {item}")
    if len(versions) > preview_limit:
        print_warn(f"为避免刷屏，仅展示前 {preview_limit} 项。")


def print_task_summary(task_payload: dict[str, Any]) -> None:
    print_info(f"任务编号：{task_payload.get('requestId')}")
    print_info(f"任务状态：{task_payload.get('status')}")
    if task_payload.get("message"):
        print_info(f"任务消息：{task_payload.get('message')}")

    data = task_payload.get("data")
    if not isinstance(data, dict):
        return

    important_fields = [
        ("coreName", "核心名称"),
        ("coreType", "核心类型"),
        ("version", "核心版本"),
        ("mcVersion", "MC 版本"),
        ("cacheHit", "缓存命中"),
        ("sharedBuild", "共享构建"),
        ("leaderRequestId", "主任务编号"),
        ("resourceKey", "资源键"),
        ("resourceDirectory", "公开目录"),
        ("resourcePath", "ZIP 资源路径"),
        ("archiveFileName", "ZIP 文件名"),
        ("downloadUrl", "下载地址"),
        ("selectedJavaKey", "实际 Java 版本"),
        ("selectedJavaCommand", "实际 Java 命令"),
        ("builtAt", "构建时间"),
    ]

    print("\n========== 任务结果摘要 ==========")
    for field_key, field_label in important_fields:
        if field_key in data and data.get(field_key) not in (None, ""):
            print(f"{field_label}: {data.get(field_key)}")
    print("==================================\n")

    if data.get("downloadUrl"):
        print_info("下载提示：任务成功后请直接使用上面的 downloadUrl 下载 ZIP。")
        print_info("启动提示：程序会额外生成通用 start 脚本；若核心自身还生成了 run 脚本，请优先使用 run。")


def run_full_flow(config: ClientConfig) -> TaskSession:
    core_type = read_input("请输入核心类型", default="paper").strip().lower()
    version = read_input("请输入核心版本", default="1.20.4").strip()
    mc_version = read_input("请输入 MC 版本", default=version).strip()

    print_info("先查询版本目录，确认当前版本是否存在。")
    catalog = get_catalog(config, core_type)
    versions = catalog.get("versions")
    if isinstance(versions, list) and version not in versions:
        print_warn(f"目录接口中暂未发现版本 {version}，但仍会继续提交，方便调试接口返回。")

    submit_payload, session = submit_build_task(config, core_type, version, mc_version)
    print_info(
        f"提交成功：requestId={submit_payload.get('requestId')} "
        f"accessToken={submit_payload.get('accessToken')}"
    )
    final_payload = poll_task(config, session)
    print_task_summary(final_payload)
    return session


def poll_existing_task(config: ClientConfig, last_session: TaskSession | None) -> TaskSession:
    request_id = read_input(
        "请输入 requestId",
        default=last_session.request_id if last_session else None,
    ).strip()
    access_token = read_input(
        "请输入 accessToken",
        default=last_session.access_token if last_session else None,
    ).strip()
    if not request_id or not access_token:
        raise OpenApiError("requestId 和 accessToken 都不能为空")

    session = TaskSession(request_id=request_id, access_token=access_token)
    final_payload = poll_task(config, session)
    print_task_summary(final_payload)
    return session


def print_current_config(config: ClientConfig, last_session: TaskSession | None) -> None:
    print("\n========== 当前配置 ==========")
    print(f"基础地址: {config.base_url}")
    print(f"User-Agent: {config.user_agent}")
    print(f"请求超时: {config.timeout_seconds:.1f} 秒")
    print(f"轮询间隔: {config.poll_interval_seconds:.1f} 秒")
    print(f"轮询超时: {config.poll_timeout_seconds:.1f} 秒")
    print(f"资源站地址: {RESOURCE_SITE_URL}")
    if last_session:
        print(f"最近任务 requestId: {last_session.request_id}")
        print(f"最近任务 accessToken: {last_session.access_token}")
    else:
        print("最近任务: 暂无")
    print("==============================\n")


def update_client_config(config: ClientConfig) -> None:
    config.base_url = read_input("请输入基础地址", default=config.base_url).strip().rstrip("/")
    config.user_agent = read_input("请输入 User-Agent", default=config.user_agent).strip()
    config.timeout_seconds = float(read_input("请输入请求超时秒数", default=str(config.timeout_seconds)))
    config.poll_interval_seconds = float(read_input("请输入轮询间隔秒数", default=str(config.poll_interval_seconds)))
    config.poll_timeout_seconds = float(read_input("请输入轮询超时秒数", default=str(config.poll_timeout_seconds)))
    print_info("客户端配置已更新。")


def print_menu() -> None:
    print("\n========== Minecraft Java 核心在线组装开放接口菜单 ==========")
    print("1. 查看当前客户端配置")
    print("2. 查询可用核心类型")
    print("3. 查询某核心类型的版本列表")
    print("4. 执行完整组装流程（提交 + 自动轮询）")
    print("5. 轮询已有任务")
    print("6. 查看资源站地址")
    print("7. 修改基础地址与轮询配置")
    print("8. 退出")
    print("==========================================================")


def read_input(prompt: str, default: str | None = None) -> str:
    if default is None:
        return input(f"{prompt}: ").strip()
    value = input(f"{prompt} [默认: {default}]: ").strip()
    return value if value else default


def main() -> int:
    config = ClientConfig()
    last_session: TaskSession | None = None

    print_info("当前脚本演示的是正式开放接口链路。")
    print_info("默认基础地址已写为 local 开发地址。")
    print_info("注意：所有真实开放接口请求都必须携带非空 User-Agent。")

    while True:
        print_menu()
        choice = input("请选择操作编号: ").strip()

        try:
            if choice == "1":
                print_current_config(config, last_session)
            elif choice == "2":
                print_catalog_core_types(config)
            elif choice == "3":
                print_catalog_versions(config)
            elif choice == "4":
                last_session = run_full_flow(config)
            elif choice == "5":
                last_session = poll_existing_task(config, last_session)
            elif choice == "6":
                print_info(f"资源站地址：{RESOURCE_SITE_URL}")
            elif choice == "7":
                update_client_config(config)
            elif choice == "8":
                print_info("已退出。")
                return 0
            else:
                print_warn("无效选项，请输入 1-8。")
        except KeyboardInterrupt:
            print_warn("检测到中断，已返回主菜单。")
        except OpenApiError as exc:
            print_error(str(exc))
        except ValueError as exc:
            print_error(f"输入格式不正确：{exc}")
        except Exception as exc:  # noqa: BLE001
            print_error(f"发生未预期异常：{exc}")


if __name__ == "__main__":
    sys.exit(main())
