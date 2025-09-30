// Small launcher for the bot.
// The real implementation lives at the repository root as `bot.js`.
// This launcher prints a few diagnostics so running `node src/bot.js` shows why
// the process may exit early (missing env or startup error) and then requires
// the real entrypoint.

console.log('Launcher: starting GymBroBot (src/bot.js)');
console.log('Launcher: DISCORD_TOKEN present?', !!process.env.DISCORD_TOKEN);
console.log('Launcher: SLASH_GUILD_ID present?', !!process.env.SLASH_GUILD_ID);
console.log('Launcher: MONGO_URI present?', !!process.env.MONGO_URI);

// Spawn a child node process to run the root bot.js so module format differences
// don't break the launcher. We forward stdout/stderr to this process.
// Use dynamic imports to remain compatible with ESM execution
import('node:child_process').then(async (cp) => {
	try {
		const { fileURLToPath } = await import('node:url');
		const scriptPath = fileURLToPath(new URL('../bot.js', import.meta.url));
		console.log('Launcher: spawning node', process.execPath, scriptPath);
		const child = cp.spawn(process.execPath, [scriptPath], { stdio: 'inherit', env: process.env, cwd: process.cwd() });
		child.on('exit', (code, sig) => {
			console.log(`Launcher: child exited code=${code} signal=${sig}`);
			process.exit(code ?? (sig ? 1 : 0));
		});
	} catch (err) {
		console.error('Launcher: failed during spawn', err);
		process.exit(1);
	}
}).catch(err => {
	console.error('Launcher: failed to import child_process', err);
	process.exit(1);
});

