# ---------- 基础依赖安装阶段 ----------
FROM debian:trixie-slim AS dependencies

ENV DEBIAN_FRONTEND=noninteractive

# 获取架构信息
ARG TARGETARCH
ARG TARGETPLATFORM

# 安装基础系统依赖包（所有架构通用）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        locales \
        wget \
        curl \
        jq \
        xdg-user-dirs \
        gnupg \
        # Python相关依赖
        python3 \
        python3-pip \
        python3-dev \
        python3-venv \
        # 基础系统工具
        nano \
        net-tools \
        netcat-openbsd \
        procps \
        tar \
        unzip \
        bzip2 \
        xz-utils \
        fonts-wqy-zenhei \
        fonts-wqy-microhei \
        libc6 \
        acl \
        sudo \
    && apt-get autoremove -y \
    && apt-get autoclean \
    && rm -rf /var/lib/apt/lists/*

# 仅在AMD64架构上安装游戏服务器依赖和i386架构支持
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        echo "检测到AMD64架构，安装游戏服务器依赖..." && \
        dpkg --add-architecture i386 && \
        apt-get update && \
        apt-get install -y --no-install-recommends \
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
            # .NET和Mono相关依赖
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
            # Unity游戏服务端依赖
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
            # ARK服务器依赖
            libelf1 \
            libelf1:i386 \
            libatomic1 \
            libatomic1:i386 \
            zlib1g:i386 \
            libc6:i386 && \
        apt-get autoremove -y && \
        apt-get autoclean && \
        rm -rf /var/lib/apt/lists/*; \
    else \
        echo "检测到ARM64架构，跳过游戏服务器依赖安装"; \
    fi

# ---------- 开发工具安装阶段 ----------
FROM dependencies AS tools

# 安装Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm config set registry https://registry.npmmirror.com \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*

# 安装Java 21（支持多架构）
RUN install -d -m 0755 /usr/share/keyrings \
    && wget -qO /usr/share/keyrings/adoptium.gpg https://packages.adoptium.net/artifactory/api/gpg/key/public \
    && echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends temurin-21-jdk \
    && rm -rf /var/lib/apt/lists/*

# 配置Python pip镜像源
RUN pip3 config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# ---------- 用户权限配置阶段 ----------
FROM tools AS base

ENV STEAM_USER=steam \
    STEAM_HOME=/root \
    STEAMCMD_DIR=/root/steamcmd \
    GAMES_DIR=/root/games \
    NODE_VERSION=22.17.0

# 设置locales
RUN sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && sed -i -e 's/# zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen

# 创建steam用户并配置权限
RUN useradd -m -s /bin/bash ${STEAM_USER} \
    && usermod -aG root ${STEAM_USER} \
    && usermod -aG sudo ${STEAM_USER} \
    && usermod -aG tty ${STEAM_USER} \
    && echo "${STEAM_USER} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# 配置steam用户的shell环境
RUN echo "set +m" >> /home/steam/.bashrc \
    && echo "export SHELL=/bin/bash" >> /home/steam/.bashrc \
    && echo "export TERM=xterm-256color" >> /home/steam/.bashrc \
    && echo "stty -echoctl 2>/dev/null || true" >> /home/steam/.bashrc \
    && echo "set +o monitor" >> /home/steam/.bashrc

# 创建目录和设置基础权限
RUN mkdir -p ${STEAMCMD_DIR} ${GAMES_DIR} /app \
    && ln -sf /root /home/steam/root_access \
    && chown -R ${STEAM_USER}:root /home/steam \
    && chown -R ${STEAM_USER}:root /app \
    && chmod -R 755 /home/steam \
    && chmod -R 755 /app \
    && chmod -R 755 /root

# 设置ACL权限，确保steam用户对root目录有完全访问权限
RUN setfacl -R -m u:${STEAM_USER}:rwx /root \
    && setfacl -R -d -m u:${STEAM_USER}:rwx /root \
    && chmod 666 /dev/tty* 2>/dev/null || true \
    && chmod 666 /dev/pts/* 2>/dev/null || true

# 设置环境变量（支持多架构）
# 动态设置JAVA_HOME
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        echo "JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64" >> /etc/environment && \
        echo "PATH=/usr/lib/jvm/temurin-21-jdk-amd64/bin:\$PATH" >> /etc/environment; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        echo "JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-arm64" >> /etc/environment && \
        echo "PATH=/usr/lib/jvm/temurin-21-jdk-arm64/bin:\$PATH" >> /etc/environment; \
    fi

# 设置通用环境变量
ENV LANG=zh_CN.UTF-8 \
    LANGUAGE=zh_CN:zh \
    LC_ALL=zh_CN.UTF-8

# 为当前构建设置JAVA_HOME（构建时使用）
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        export JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
        export JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-arm64; \
    fi

# ---------- 构建阶段 ----------
FROM base AS builder

# 拷贝源码用于构建
COPY --chown=steam:steam . /app/
USER ${STEAM_USER}
WORKDIR /app

# 使用 npm 构建前后端产物（针对不同架构优化）
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        echo "ARM64架构构建，使用优化配置..." && \
        export NODE_OPTIONS="--max-old-space-size=2048" && \
        npm config set fetch-retry-mintimeout 20000 && \
        npm config set fetch-retry-maxtimeout 120000 && \
        npm config set fetch-timeout 300000 && \
        npm run install:all && \
        npm run package:linux:no-zip; \
    else \
        echo "AMD64架构构建，使用标准配置..." && \
        npm run install:all && \
        npm run package:linux:no-zip; \
    fi

# ---------- 运行阶段（最终镜像） ----------
FROM base AS runtime

# 仅在AMD64架构上安装并初始化 SteamCMD
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        echo "在AMD64架构上安装SteamCMD..." && \
        mkdir -p ${STEAMCMD_DIR} && \
        cd ${STEAMCMD_DIR} && \
        (wget -t 5 --retry-connrefused --waitretry=1 --read-timeout=20 --timeout=15 -O steamcmd_linux.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
        || wget -t 5 --retry-connrefused --waitretry=1 --read-timeout=20 --timeout=15 -O steamcmd_linux.tar.gz https://media.steampowered.com/installer/steamcmd_linux.tar.gz) && \
        tar -xzvf steamcmd_linux.tar.gz && \
        rm steamcmd_linux.tar.gz && \
        chmod +x ${STEAMCMD_DIR}/steamcmd.sh && \
        cd ${STEAMCMD_DIR} && ./steamcmd.sh +quit && \
        mkdir -p ${STEAM_HOME}/.steam/sdk32 ${STEAM_HOME}/.steam/sdk64 && \
        ln -sf ${STEAMCMD_DIR}/linux32/steamclient.so ${STEAM_HOME}/.steam/sdk32/steamclient.so && \
        ln -sf ${STEAMCMD_DIR}/linux64/steamclient.so ${STEAM_HOME}/.steam/sdk64/steamclient.so && \
        mkdir -p ${STEAM_HOME}/.steam/sdk32/steamclient.so.dbg.sig ${STEAM_HOME}/.steam/sdk64/steamclient.so.dbg.sig && \
        mkdir -p ${STEAM_HOME}/.steam/steam && \
        ln -sf ${STEAMCMD_DIR}/linux32 ${STEAM_HOME}/.steam/steam/linux32 && \
        ln -sf ${STEAMCMD_DIR}/linux64 ${STEAM_HOME}/.steam/steam/linux64 && \
        ln -sf ${STEAMCMD_DIR}/steamcmd ${STEAM_HOME}/.steam/steam/steamcmd; \
    else \
        echo "ARM64架构，跳过SteamCMD安装" && \
        mkdir -p ${STEAMCMD_DIR} ${GAMES_DIR}; \
    fi

# 拷贝构建产物与默认数据
COPY --from=builder /app/dist/package/ /root/
COPY --from=builder /app/server/data/ /root/server/data/
# 拷贝 Python 依赖清单并安装
COPY --from=builder /app/server/src/Python/requirements.txt /tmp/requirements.txt
# 安装Python依赖并配置最终权限
RUN PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install --no-cache-dir -r /tmp/requirements.txt \
    && rm -rf /root/.cache/pip /home/steam/.cache /tmp/* /var/tmp/* \
    && chmod -R 775 /root /root/server /root/server/data

# 最终权限配置
RUN setfacl -R -m u:steam:rwx /root \
    && setfacl -R -d -m u:steam:rwx /root \
    && echo "export ROOT_ACCESS=/root" >> /home/steam/.bashrc \
    && echo "export PATH=/root:\$PATH" >> /home/steam/.bashrc \
    && chown steam:tty /dev/tty* 2>/dev/null || true \
    && chmod g+rw /dev/tty* 2>/dev/null || true

# 复制启动脚本到root目录
COPY start.sh /root/start.sh
RUN chmod +x /root/start.sh

# 创建steam用户专用的shell启动脚本
RUN echo '#!/bin/bash' > /home/steam/steam_shell.sh \
    && echo 'export SHELL=/bin/bash' >> /home/steam/steam_shell.sh \
    && echo 'export TERM=xterm-256color' >> /home/steam/steam_shell.sh \
    && echo 'set +m' >> /home/steam/steam_shell.sh \
    && echo 'set +o monitor' >> /home/steam/steam_shell.sh \
    && echo 'stty -echoctl 2>/dev/null || true' >> /home/steam/steam_shell.sh \
    && echo 'cd /root' >> /home/steam/steam_shell.sh \
    && echo 'exec /bin/bash --login "$@"' >> /home/steam/steam_shell.sh \
    && chmod +x /home/steam/steam_shell.sh \
    && chown steam:steam /home/steam/steam_shell.sh

# 创建目录用于挂载游戏数据
VOLUME ["${GAMES_DIR}"]

# 暴露GSM3管理面板端口
EXPOSE 3001

# 保持root用户
USER root
WORKDIR /root

# 启动容器时运行start.sh
ENTRYPOINT ["/root/start.sh"]