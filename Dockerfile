# 基础镜像：使用 Node.js 20 的 Alpine Linux 版本
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apk add --no-cache \
    # 基本构建工具
    python3 \
    make \
    g++ \
    # Playwright 依赖
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    # X11 和显示相关依赖
    xvfb \
    x11vnc \
    xorg-server \
    # 其他依赖
    gcompat \
    dbus \
    eudev \
    ttf-liberation \
    fontconfig

# 设置 Playwright 的环境变量
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_VALIDATION=1
ENV DISPLAY=:99

# 复制依赖文件并安装
COPY package*.json tsconfig.json ./
RUN npm install

# 复制源代码和静态文件
COPY src/ ./src/
COPY index.html ./index.html
RUN npm run build

# 创建 X11 目录并设置权限
RUN mkdir -p /tmp/.X11-unix && \
    chmod 1777 /tmp/.X11-unix

# 创建启动脚本
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'Xvfb :99 -screen 0 1024x768x16 -ac &' >> /app/start.sh && \
    echo 'sleep 2' >> /app/start.sh && \
    echo 'node dist/index.js' >> /app/start.sh && \
    chmod +x /app/start.sh

# 声明容器要暴露的端口
EXPOSE 7860
ENV PORT=7860

# 启动应用
CMD ["/bin/sh", "/app/start.sh"]


