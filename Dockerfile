# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Install yarn
RUN apk add --no-cache yarn

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including dev dependencies for build)
RUN yarn install --ignore-scripts

# Copy source code
COPY . .

# Build the application
RUN yarn build && ls -la build/

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application
CMD ["node", "build/index.js"] 