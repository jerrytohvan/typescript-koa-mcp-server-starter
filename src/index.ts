import { z } from 'zod';
import { CallToolResult, GetPromptResult, ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer } from "./server_runner.js";


console.log("Initializing MCP Streamable-HTTP Server");

// Create the server
const { server, start } = createMcpServer({
  name: "streamable-mcp-server",
});

// Configure the server with tools
server.tool(
  'greet',
  'A simple greeting tool',
  {
    name: z.string().describe('Name to greet'),
  },
  async ({ name }: { name: string }): Promise<CallToolResult> => {
    console.log(`Tool Called: greet (name=${name})`);
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${name}!`,
        },
      ],
    };
  }
);

// Register a tool that sends multiple greetings with notifications
server.tool(
  'multi-greet',
  'A tool that sends different greetings with delays between them',
  {
    name: z.string().describe('Name to greet'),
  },
  async ({ name }: { name: string }, { sendNotification }: { sendNotification: any }): Promise<CallToolResult> => {
    console.log(`Tool Called: multi-greet (name=${name})`);
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    await sendNotification({
      method: "notifications/message",
      params: { level: "debug", data: `Starting multi-greet for ${name}` }
    });

    await sleep(1000); // Wait 1 second before first greeting

    await sendNotification({
      method: "notifications/message",
      params: { level: "info", data: `Sending first greeting to ${name}` }
    });

    await sleep(1000); // Wait another second before second greeting

    await sendNotification({
      method: "notifications/message",
      params: { level: "info", data: `Sending second greeting to ${name}` }
    });

    return {
      content: [
        {
          type: 'text',
          text: `Good morning, ${name}!`,
        }
      ],
    };
  }
);

// Register a tool for testing resumability
server.tool(
  'start-notification-stream',
  'Starts sending periodic notifications for testing resumability',
  {
    interval: z.number().describe('Interval in milliseconds between notifications').default(100),
    count: z.number().describe('Number of notifications to send (0 for 100)').default(50),
  },
  async ({ interval, count }: { interval: number; count: number }, { sendNotification }: { sendNotification: any }): Promise<CallToolResult> => {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    let counter = 0;

    while (count === 0 || counter < count) {
      counter++;
      try {
        await sendNotification({
          method: "notifications/message",
          params: {
            level: "info",
            data: `Periodic notification #${counter} at ${new Date().toISOString()}`
          }
        });
      }
      catch (error) {
        console.error("Error sending notification:", error);
      }
      // Wait for the specified interval
      await sleep(interval);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Started sending periodic notifications every ${interval}ms`,
        }
      ],
    };
  }
);

// Start the server
const servers = start();
