# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Install yarn
RUN apk add --no-cache yarn

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including dev dependencies for build)
RUN yarn install --frozen-lockfile --ignore-scripts

# Copy source code and config files
COPY . .

# Build the application
RUN yarn build

# Expose port
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Start the application
CMD ["node", "build/index.js"] 