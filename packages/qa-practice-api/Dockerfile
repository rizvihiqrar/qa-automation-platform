# The API as an image, for the build-promotion check in packages/release-gate.
# Only what the server needs: production dependencies and src. Settings (the port, the
# admin account, the database) come from the environment when the container starts.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV PORT=4000
EXPOSE 4000
USER node
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.ts"]
