#!/bin/bash

# Deploy script for TypeScript MCP Server to Google Cloud Run

set -e

# Configuration
PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME="streamable-mcp-server"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying TypeScript MCP Server to Cloud Run${NC}"
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Service Name: $SERVICE_NAME"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${YELLOW}⚠️  You are not authenticated with gcloud. Please run:${NC}"
    echo "gcloud auth login"
    exit 1
fi

# Check if project is set
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ No project ID found. Please set it with:${NC}"
    echo "gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

# Build the Docker image
echo -e "${YELLOW}📦 Building Docker image...${NC}"
docker build --platform linux/amd64 -t $IMAGE_NAME .

# Push the image to Container Registry
echo -e "${YELLOW}⬆️  Pushing image to Container Registry...${NC}"
docker push $IMAGE_NAME

# Deploy to Cloud Run
echo -e "${YELLOW}🚀 Deploying to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 8080 \
    --memory 512Mi \
    --cpu 1 \
    --max-instances 10 \
    --timeout 300 \
    --set-env-vars NODE_ENV=production

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo ""
echo -e "${GREEN}✅ Deployment successful!${NC}"
echo -e "${GREEN}🌐 Service URL: $SERVICE_URL${NC}"
echo ""
echo -e "${YELLOW}📋 To test the MCP server:${NC}"
echo "curl -X POST $SERVICE_URL/mcp \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Accept: application/json' \\"
echo "  -d '{\"jsonrpc\":\"2.0\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test-client\",\"version\":\"1.0.0\"}},\"id\":1}'"
echo ""
echo -e "${YELLOW}🔧 To view logs:${NC}"
echo "gcloud logs tail --service=$SERVICE_NAME --region=$REGION" 