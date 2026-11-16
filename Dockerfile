# 容器镜像：把饭点跑成任意容器平台（腾讯云 CloudBase 云托管 / 阿里云 FC / 自建 Docker）都能用
# 零 npm 依赖，所以不需要 npm install
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public

# 平台通常注入 PORT；本项目 config.js 会优先读 process.env.PORT
ENV PORT=80
ENV NODE_ENV=production
EXPOSE 80

CMD ["node", "server/index.js"]
