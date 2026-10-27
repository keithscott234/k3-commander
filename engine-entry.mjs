// Runs in .runtime. No hosted relay, account login, setup, or automatic Chrome download.
process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';
global.disableOnboarding = true;
await import('./dist/bootstrap.js');
const { FilteredStdioServerTransport } = await import('./dist/custom-stdio.js');
const { server, flushDeferredMessages } = await import('./dist/server.js');
const { configManager } = await import('./dist/config-manager.js');
const transport = new FilteredStdioServerTransport();
global.mcpTransport = transport;
await configManager.loadConfig();
server.oninitialized = () => { transport.enableNotifications(); flushDeferredMessages(); };
await server.connect(transport);
