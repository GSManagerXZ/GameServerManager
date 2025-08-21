FROM debian:trixie-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    STEAM_USER=steam \
    STEAM_HOME=/root \
    STEAMCMD_DIR=/root/steamcmd \
    GAMES_DIR=/root/games \
    NODE_VERSION=22.17.0

# 安装所有依赖（不执行 upgrade）并清理缓存
RUN apt-get update \
    && dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        locales \
        wget \
        curl \
        jq \
        xdg-user-dirs \
        # Node.js相关依赖
        gnupg \
        # Python相关依赖
        python3 \
        python3-pip \
        python3-dev \
        python3-venv \
        # 游戏服务器依赖
        libncurses6:i386 \
        libbz2-1.0:i386 \
        libicu-dev \
        libxml2:i386 \
        libstdc++6:i386 \
        lib32gcc-s1 \
        libc6-i386 \
        lib32stdc++6 \
        libcurl4-gnutls-dev:i386 \
        libcurl4-gnutls-dev \
        libgl1 \
        gcc-13-base:i386 \
        libssl3:i386 \
        libopenal1:i386 \
        libtinfo6:i386 \
        libtcmalloc-minimal4:i386 \
        # .NET和Mono相关依赖（ECO服务器等需要）
        libgdiplus \
        libc6-dev \
        libasound2 \
        libpulse0 \
        libnss3 \
        libcap2 \
        libatk1.0-0 \
        libcairo2 \
        libcups2 \
        libgtk-3-0 \
        libgdk-pixbuf-2.0-0 \
        libpango-1.0-0 \
        libx11-6 \
        libxt6 \
        # Unity游戏服务端额外依赖（7日杀等）
        libsdl2-2.0-0:i386 \
        libsdl2-2.0-0 \
        libpulse0:i386 \
        libfontconfig1:i386 \
        libfontconfig1 \
        libudev1:i386 \
        libudev1 \
        libpugixml1v5 \
        libvulkan1 \
        libvulkan1:i386 \
        # 额外的Unity引擎依赖（特别针对7日杀）
        libatk1.0-0:i386 \
        libxcomposite1 \
        libxcomposite1:i386 \
        libxcursor1 \
        libxcursor1:i386 \
        libxrandr2 \
        libxrandr2:i386 \
        libxss1 \
        libxss1:i386 \
        libxtst6 \
        libxtst6:i386 \
        libxi6 \
        libxi6:i386 \
        libxkbfile1 \
        libxkbfile1:i386 \
        libasound2:i386 \
        libgtk-3-0:i386 \
        libdbus-1-3 \
        libdbus-1-3:i386 \
        # ARK: Survival Evolved（方舟生存进化）服务器额外依赖
        libelf1 \
        libelf1:i386 \
        libatomic1 \
        libatomic1:i386 \
        nano \
        net-tools \
        netcat-openbsd \
        procps \
        tar \
        unzip \
        bzip2 \
        xz-utils \
        zlib1g:i386 \
        fonts-wqy-zenhei \
        fonts-wqy-microhei \
        libc6 \
        libc6:i386 \
    # 安装Node.js
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    # 安装Java 21（通过Adoptium仓库，使用 keyrings 方式，替代已弃用的 apt-key）
    && install -d -m 0755 /usr/share/keyrings \
    && wget -qO /usr/share/keyrings/adoptium.gpg https://packages.adoptium.net/artifactory/api/gpg/key/public \
    && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends temurin-21-jdk \
    # 配置npm和pip镜像源
    && npm config set registry https://registry.npmmirror.com \
    && npm install -g npm@latest \
    && pip3 config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    # 设置locales
    && sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && sed -i -e 's/# zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen \
    # 创建steam用户和应用目录，并给予root权限
    && useradd -m -s /bin/bash ${STEAM_USER} \
    && usermod -aG root ${STEAM_USER} \
    && usermod -aG sudo ${STEAM_USER} \
    && echo "${STEAM_USER} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && mkdir -p ${STEAMCMD_DIR} ${GAMES_DIR} /app \
    && chown -R ${STEAM_USER}:root /home/steam \
    && chown -R ${STEAM_USER}:root /app \
    && chmod -R 755 /home/steam \
    && chmod -R 755 /app \
    # 清理apt缓存和临时文件
    && apt-get autoremove -y \
    && apt-get autoclean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/* \
    && rm -rf /var/cache/apt/archives/*

# 设置环境变量
ENV JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64 \
    PATH="$JAVA_HOME/bin:$PATH" \
    LANG=zh_CN.UTF-8 \
    LANGUAGE=zh_CN:zh \
    LC_ALL=zh_CN.UTF-8

# ---------- 构建阶段 ----------
FROM base AS builder

# 拷贝源码用于构建
COPY --chown=steam:steam . /app/
USER ${STEAM_USER}
WORKDIR /app

# 使用 npm 构建前后端产物
RUN npm run install:all \
    && npm run package:linux:no-zip

# ---------- 运行阶段（最终镜像） ----------
FROM base AS runtime

# 安装并初始化 SteamCMD
RUN mkdir -p ${STEAMCMD_DIR} \
    && cd ${STEAMCMD_DIR} \
    && wget -t 5 --retry-connrefused --waitretry=1 --read-timeout=20 --timeout=15 -O steamcmd_linux.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
    || wget -t 5 --retry-connrefused --waitretry=1 --read-timeout=20 --timeout=15 -O steamcmd_linux.tar.gz https://media.steampowered.com/installer/steamcmd_linux.tar.gz \
    && tar -xzvf steamcmd_linux.tar.gz \
    && rm steamcmd_linux.tar.gz \
    && chmod +x ${STEAMCMD_DIR}/steamcmd.sh \
    && cd ${STEAMCMD_DIR} && ./steamcmd.sh +quit \
    && mkdir -p ${STEAM_HOME}/.steam/sdk32 ${STEAM_HOME}/.steam/sdk64 \
    && ln -sf ${STEAMCMD_DIR}/linux32/steamclient.so ${STEAM_HOME}/.steam/sdk32/steamclient.so \
    && ln -sf ${STEAMCMD_DIR}/linux64/steamclient.so ${STEAM_HOME}/.steam/sdk64/steamclient.so \
    && mkdir -p ${STEAM_HOME}/.steam/sdk32/steamclient.so.dbg.sig ${STEAM_HOME}/.steam/sdk64/steamclient.so.dbg.sig \
    && mkdir -p ${STEAM_HOME}/.steam/steam \
    && ln -sf ${STEAMCMD_DIR}/linux32 ${STEAM_HOME}/.steam/steam/linux32 \
    && ln -sf ${STEAMCMD_DIR}/linux64 ${STEAM_HOME}/.steam/steam/linux64 \
    && ln -sf ${STEAMCMD_DIR}/steamcmd ${STEAM_HOME}/.steam/steam/steamcmd

# 拷贝构建产物与默认数据
COPY --from=builder /app/dist/package/ /root/
COPY --from=builder /app/server/data/ /root/server/data/
# 拷贝 Python 依赖清单并安装
COPY --from=builder /app/server/src/Python/requirements.txt /tmp/requirements.txt
RUN PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install --no-cache-dir -r /tmp/requirements.txt \
    && rm -rf /root/.cache/pip /home/steam/.cache /tmp/* /var/tmp/* \
    && chmod -R 775 /root /root/server /root/server/data

# 复制启动脚本到root目录
COPY start.sh /root/start.sh
RUN chmod +x /root/start.sh

# 创建目录用于挂载游戏数据
VOLUME ["${GAMES_DIR}"]

# 暴露GSM3管理面板端口
EXPOSE 3001

# 保持root用户
USER root
WORKDIR /root

# 启动容器时运行start.sh
ENTRYPOINT ["/root/start.sh"]