import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			// The 'vscode' module only exists inside the Extension Host.
			// Unit tests resolve it to a minimal mock instead.
			vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
