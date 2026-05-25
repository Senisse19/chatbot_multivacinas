# Estágio de Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala dependências (incluindo devDependencies para o tsc)
RUN npm install

# Copia o restante do código
COPY . .

# Compila o TypeScript para JavaScript
RUN npm run build

# ---------------------------------------------------
# Estágio de Produção
FROM node:22-alpine

WORKDIR /app

# Configura para produção
ENV APP_ENV=production
ENV NODE_ENV=production

# Copia os arquivos de dependência
COPY package*.json ./

# Instala APENAS as dependências necessárias para rodar (ignora tsc, @types, etc)
RUN npm install --omit=dev

# Copia o código compilado do estágio anterior
COPY --from=builder /app/dist ./dist

# Expõe a porta do servidor
EXPOSE 3000

# Inicia a aplicação
CMD ["node", "dist/index.js"]
