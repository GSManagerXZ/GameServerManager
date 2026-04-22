#!/usr/bin/env python3
"""我的世界整合包在线构建开放接口测试脚本。"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, parse, request


TERMINAL_STATUSES = {"SUCCESS", "FAILED", "CANCELLED"}
DEFAULT_SOURCE = "https://modrinth.com/modpack/skyblock-plus?version=26.1"
DEFAULT_USER_AGENT = "tools-web-openapi-test/1.0"


def parse_json_bytes(raw_bytes: bytes) -> Any:
    text = raw_bytes.decode("utf-8", errors="replace")
    return json.loads(text)


def send_json_request(
    url: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> tuple[int, Any, dict[str, str]]:
    body = None
    merged_headers = {"Accept": "application/json"}
    if headers:
        merged_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        merged_headers.setdefault("Content-Type", "application/json")

    req = request.Request(url=url, data=body, headers=merged_headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw_bytes = response.read()
            data = parse_json_bytes(raw_bytes) if raw_bytes else None
            return response.status, data, dict(response.headers.items())
    except error.HTTPError as exc:
        raw_bytes = exc.read()
        try:
            data = parse_json_bytes(raw_bytes) if raw_bytes else None
        except json.JSONDecodeError:
            data = raw_bytes.decode("utf-8", errors="replace")
        return exc.code, data, dict(exc.headers.items())


def download_binary(url: str, output_path: Path, user_agent: str, timeout: float = 300.0) -> None:
    req = request.Request(
        url=url,
        headers={
            "Accept": "*/*",
            "User-Agent": user_agent,
        },
        method="GET",
    )
    with request.urlopen(req, timeout=timeout) as response:
        output_path.write_bytes(response.read())


def build_default_headers(user_agent: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "User-Agent": user_agent,
    }


def submit_modpack_task(
    base_url: str,
    platform: str,
    source: str,
    version: str,
    user_agent: str,
) -> tuple[int, Any, dict[str, str]]:
    payload = {
        "params": {
            "platform": platform,
            "source": source,
            "version": version,
        }
    }
    url = f"{base_url.rstrip('/')}/api/open/tools/minecraft-modpack-assembler/execute"
    return send_json_request(url, method="POST", payload=payload, headers=build_default_headers(user_agent))


def poll_task_status(
    base_url: str,
    request_id: str,
    access_token: str,
    user_agent: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
) -> dict[str, Any]:
    task_url = f"{base_url.rstrip('/')}/api/open/tools/minecraft-modpack-assembler/tasks/{parse.quote(request_id)}"
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        status_code, payload, _ = send_json_request(
            task_url,
            headers={
                **build_default_headers(user_agent),
                "X-Task-Access-Token": access_token,
            },
        )
        if status_code >= 400:
            raise RuntimeError(f"轮询任务失败，HTTP {status_code}，响应：{payload}")
        if not isinstance(payload, dict):
            raise RuntimeError(f"轮询任务返回了非 JSON 对象：{payload!r}")

        status = str(payload.get("status", "")).upper()
        print(f"[任务轮询] status={status} requestId={payload.get('requestId')}")
        if status in TERMINAL_STATUSES:
            return payload

        time.sleep(poll_interval_seconds)

    raise TimeoutError(f"任务在 {timeout_seconds} 秒内未进入终态")


def derive_download_name(task_payload: dict[str, Any]) -> str:
    data = task_payload.get("data")
    if isinstance(data, dict):
        archive_name = data.get("archiveFileName")
        if isinstance(archive_name, str) and archive_name.strip():
            return archive_name.strip()
    return "minecraft-modpack-assembler-result.zip"


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="测试 minecraft-modpack-assembler 开放接口的提交流程、轮询与下载")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080", help="平台基础地址")
    parser.add_argument("--platform", default="modrinth", help="来源平台，当前仅支持 modrinth")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="整合包来源，可传 Modrinth 项目页、版本页、slug 或项目 ID")
    parser.add_argument("--version", default="", help="可选：指定版本号或版本 ID")
    parser.add_argument("--timeout", type=float, default=1800.0, help="任务轮询超时时间（秒）")
    parser.add_argument("--poll-interval", type=float, default=2.0, help="任务轮询间隔（秒）")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT, help="真实开放接口请求头 User-Agent")
    parser.add_argument("--download", action="store_true", help="任务成功后自动下载最终 ZIP")
    parser.add_argument("--download-dir", default="tmp/minecraft-modpack-assembler-open-api-test", help="ZIP 下载目录")
    return parser


def main() -> int:
    args = build_argument_parser().parse_args()

    print(f"[执行接口] {args.base_url.rstrip('/')}/api/open/tools/minecraft-modpack-assembler/execute")
    print(f"[请求头] User-Agent={args.user_agent}")
    print(f"[请求参数] platform={args.platform} source={args.source} version={args.version or '<latest>'}")

    status_code, submit_payload, _ = submit_modpack_task(
        args.base_url,
        args.platform,
        args.source,
        args.version,
        user_agent=args.user_agent,
    )
    if status_code >= 400:
        print(f"[提交任务] 失败，HTTP {status_code}，响应：{submit_payload}")
        return 1
    if not isinstance(submit_payload, dict):
        print(f"[提交任务] 返回了非 JSON 对象：{submit_payload!r}")
        return 1

    request_id = str(submit_payload.get("requestId", "")).strip()
    access_token = str(submit_payload.get("accessToken", "")).strip()
    if not request_id or not access_token:
        print(f"[提交任务] 缺少 requestId 或 accessToken，响应：{submit_payload}")
        return 1

    print(
        "[提交任务] 成功，"
        f"requestId={request_id} status={submit_payload.get('status')} requestSource={submit_payload.get('requestSource')}"
    )
    try:
        task_payload = poll_task_status(
            args.base_url,
            request_id,
            access_token,
            user_agent=args.user_agent,
            timeout_seconds=args.timeout,
            poll_interval_seconds=args.poll_interval,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[任务轮询] 失败：{exc}")
        return 1

    final_status = str(task_payload.get("status", "")).upper()
    print(f"[任务完成] status={final_status}")
    if final_status != "SUCCESS":
        print(f"[任务完成] 任务未成功，响应：{task_payload}")
        return 1

    data = task_payload.get("data")
    if isinstance(data, dict):
        print("[结果摘要]")
        print(f"  - projectTitle: {data.get('projectTitle')}")
        print(f"  - versionNumber: {data.get('versionNumber')}")
        print(f"  - minecraftVersion: {data.get('minecraftVersion')}")
        print(f"  - loader: {data.get('loader')}")
        print(f"  - cacheHit: {data.get('cacheHit')}")
        print(f"  - downloadUrl: {data.get('downloadUrl')}")

        if args.download:
            download_url = data.get("downloadUrl")
            if isinstance(download_url, str) and download_url.strip():
                download_dir = Path(args.download_dir)
                download_dir.mkdir(parents=True, exist_ok=True)
                output_path = download_dir / derive_download_name(task_payload)
                print(f"[产物下载] 正在下载到 {output_path}")
                try:
                    download_binary(download_url, output_path, args.user_agent)
                except Exception as exc:  # noqa: BLE001
                    print(f"[产物下载] 下载失败：{exc}")
                    return 1
                print(f"[产物下载] 下载完成：{output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
