FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.js .
ENV PORT=8080
# actualiza yt-dlp en cada arranque (YouTube cambia seguido)
CMD ["sh","-c","pip3 install --break-system-packages -U yt-dlp && node server.js"]
