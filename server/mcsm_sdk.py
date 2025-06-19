import requests


# 创建实例
def create_instance(urlapi,daemonId, apikey, nickname, cwd, image, CUSTOM_RUN_SCRIPT):
    """
    :param urlapi: 接口地址
    :param daemonId: 守护进程ID
    :param apikey: API密钥
    :param nickname: 实例名称
    :param cwd: 工作目录
    :param image: Docker镜像名称
    :param CUSTOM_RUN_SCRIPT: 启动脚本名称
    """
    
    url = f"http://{urlapi}/api/instance?daemonId={daemonId}&apikey={apikey}"

    payload = {
        "nickname": nickname,
        "startCommand": "",
        "stopCommand": "^c",
        "cwd": cwd,
        "ie": "utf8",
        "oe": "utf8",
        "createDatetime": 1749965402266,
        "lastDatetime": 1749967710715,
        "type": "steam/universal",
        "tag": [],
        "endTime": 0,
        "fileCode": "utf8",
        "processType": "docker",
        "updateCommand": "",
        "crlf": 2,
        "category": 0,
        "enableRcon": False,
        "rconPassword": "",
        "rconPort": 0,
        "rconIp": "",
        "actionCommandList": [],
        "terminalOption": {
            "haveColor": True,
            "pty": True,
            "ptyWindowCol": 164,
            "ptyWindowRow": 40
        },
        "eventTask": {
            "autoStart": False,
            "autoRestart": False,
            "ignore": False
        },
        "docker": {
            "containerName": "",
            "image": image,
            "ports": [],
            "extraVolumes": [],
            "memory": 0,
            "networkMode": "host",
            "networkAliases": [],
            "cpusetCpus": "",
            "cpuUsage": 0,
            "maxSpace": 0,
            "io": 0,
            "network": 0,
            "workingDir": "/data",
            "env": [
                "CUSTOM_RUN_DIR=/data",
                f"CUSTOM_RUN_SCRIPT=./{CUSTOM_RUN_SCRIPT}"
            ],
            "changeWorkdir": False
        },
        "pingConfig": {
            "ip": "",
            "port": 25565,
            "type": 1
        },
        "extraServiceConfig": {
            "openFrpTunnelId": "",
            "openFrpToken": "",
            "isOpenFrp": False
        }
    }
    
    headers = {
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Apifox/1.0.0 (https://apifox.com)',
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': '*/*',
        'Host': '192.168.10.23:23333',
        'Connection': 'keep-alive'
    }

    response = requests.post(url, headers=headers, json=payload)

    return response.json()