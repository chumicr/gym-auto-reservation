# Usa una imagen de Node.js oficial basada en Debian (mejor para Puppeteer)
FROM node:20-slim

# Instalar dependencias necesarias para que Google Chrome funcione en Linux
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxpm4 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de la app
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --only=production

# Instalar el navegador Chrome necesario para Puppeteer
RUN npx puppeteer browsers install chrome

# Copiar el resto del código
COPY . .

# Exponer el puerto configurado (3000 por defecto)
EXPOSE 3000

# Variables de entorno por defecto para producción
ENV NODE_ENV=production
ENV HEADLESS=true
ENV PORT=3000

# Comando para arrancar la aplicación
CMD ["npm", "start"]
