FROM node:20-slim

# Dossier de travail
WORKDIR /app

# Installer les dépendances Node
COPY package*.json ./
RUN npm install

# Installer ffmpeg dans le container
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Copier le code
COPY . .

# Lancer le serveur
CMD ["npm", "start"]
