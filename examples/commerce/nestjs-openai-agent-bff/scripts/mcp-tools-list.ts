#!/usr/bin/env tsx
/**
 * Dev-only CLI script to list available MCP tools.
 *
 * This script connects to the Norce MCP server and retrieves the list of
 * available tools using the tools/list JSON-RPC method.
 *
 * Usage:
 *   npm run mcp:tools        # Print tool names and descriptions
 *   npm run mcp:tools:full   # Also print input schemas
 *
 * Environment variables required:
 *   - NORCE_MCP_BASE_URL
 *   - NORCE_OAUTH_TOKEN_URL
 *   - NORCE_OAUTH_CLIENT_ID
 *   - NORCE_OAUTH_CLIENT_SECRET
 *   - NORCE_OAUTH_SCOPE
 *
 * NOTE: This script does NOT print tokens or secrets.
 */

import { config } from '../src/config.js';
import { NorceTokenProvider } from '../src/norce/NorceTokenProvider.js';
import { NorceMcpClient, type McpToolDefinition } from '../src/norce/NorceMcpClient.js';
import type { McpState } from '../src/session/sessionTypes.js';

const FULL_FLAG = '--full';

function printUsage(): void {
  console.log('Usage: tsx scripts/mcp-tools-list.ts [--full]');
  console.log('');
  console.log('Options:');
  console.log('  --full    Print full input schema for each tool');
  console.log('');
  console.log('Environment variables required:');
  console.log('  NORCE_MCP_BASE_URL');
  console.log('  NORCE_OAUTH_TOKEN_URL, NORCE_OAUTH_CLIENT_ID');
  console.log('  NORCE_OAUTH_CLIENT_SECRET, NORCE_OAUTH_SCOPE');
}

function printToolSummary(tool: McpToolDefinition): void {
  const description = tool.description ?? '(no description)';
  console.log(`  ${tool.name}`);
  console.log(`    ${description}`);
}

function printToolFull(tool: McpToolDefinition): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Tool: ${tool.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Description: ${tool.description ?? '(no description)'}`);

  if (tool.inputSchema) {
    console.log('\nInput Schema:');
    console.log(JSON.stringify(tool.inputSchema, null, 2));
  } else {
    console.log('\nInput Schema: (none)');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showFull = args.includes(FULL_FLAG);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  console.log('MCP Tools List - Dev-only utility');
  console.log('==================================\n');

  console.log('Connecting to MCP server...');
  console.log(`  Base URL: ${config.norce.mcp.baseUrl}`);

  const applicationId = "1234"; // Replace with your actual application ID

  const tokenProvider = new NorceTokenProvider({
    clientId: config.norce.oauth.clientId,
    clientSecret: config.norce.oauth.clientSecret,
    tokenUrl: config.norce.oauth.tokenUrl,
    scope: config.norce.oauth.scope,
  });

  const mcpClient = new NorceMcpClient({
    baseUrl: config.norce.mcp.baseUrl
  });

  const mcpState: McpState = {
    sessionId: undefined,
    nextRpcId: 1,
  };

  try {
    console.log('Fetching OAuth token...');
    const accessToken = await tokenProvider.getAccessToken(applicationId)
    console.log('  Token acquired successfully (not printed for security)\n');

    console.log('Initializing MCP session...');
    await mcpClient.ensureInitialized(mcpState, accessToken, applicationId);
    console.log(`  Session ID: ${mcpState.sessionId ?? '(none)'}\n`);

    console.log('Calling tools/list...\n');
    const result = await mcpClient.listTools(mcpState, accessToken, applicationId);

    const tools = result.tools ?? [];

    if (tools.length === 0) {
      console.log('No tools found.');
      return;
    }

    console.log(`Found ${tools.length} tool(s):\n`);

    if (showFull) {
      for (const tool of tools) {
        printToolFull(tool);
      }
    } else {
      for (const tool of tools) {
        printToolSummary(tool);
      }
      console.log('\nRun with --full flag to see input schemas.');
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
