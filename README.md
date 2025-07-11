# Image Crawler MCP Server

This MCP server provides access to your AWS Lambda-based SaaS image crawling service through the Model Context Protocol.

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure your endpoints
4. Build the project: `npm run build`
5. Configure Claude Desktop (see Configuration section)

## Configuration

Add this to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "image-crawler": {
      "command": "node",
      "args": ["/path/to/your/image-crawler-mcp/dist/index.js"],
      "env": {
        "LAMBDA_ENDPOINT": "https://your-api-gateway-url.amazonaws.com/prod",
        "API_KEY": "your-api-key"
      }
    }
  }
}
