FROM node:22-slim
WORKDIR /app
COPY package.json ./
# Use the same @actual-app/api version as your Actual server (e.g. --build-arg ACTUAL_API_VERSION=26.11.0).
ARG ACTUAL_API_VERSION=""
RUN npm install --omit=dev \
 && if [ -n "$ACTUAL_API_VERSION" ]; then npm install --omit=dev --no-save "@actual-app/api@$ACTUAL_API_VERSION"; fi
COPY src ./src
COPY public ./public
ENV DATA_DIR=/data PORT=3000 NODE_ENV=production
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
