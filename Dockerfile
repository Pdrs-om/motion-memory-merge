FROM node:20-slim

# Dossier de travail dans le container
WORKDIR /app

# Copier les fichiers de configuration npm
COPY package*.json ./

# Installer les dépendances
RUN npm install --omit=dev

# Copier le reste du code
COPY . .

# Port exposé par le serveur Node
EXPOSE 3000

# Commande de démarrage
CMD ["npm", "start"]
