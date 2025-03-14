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
    # 其他依赖
    gcompat

# 设置 Playwright 的环境变量
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_VALIDATION=1

# 复制依赖文件并安装
COPY package*.json tsconfig.json ./
RUN npm install

# 复制源代码和静态文件
COPY src/ ./src/
COPY index.html ./index.html
RUN npm run build

# 创建非 root 用户和用户组
RUN addgroup -S -g 1001 nodejs && \
    adduser -S -D -H -u 1001 -G nodejs hono

# 设置应用文件的所有权
RUN chown -R hono:nodejs /app

# 切换到非 root 用户
USER hono

# 声明容器要暴露的端口
EXPOSE 7860
ENV PORT=7860

# 启动应用
CMD ["node", "dist/index.js"]
