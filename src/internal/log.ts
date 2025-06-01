import chalk from 'chalk';
// Logger utility
const log = {
	info: (message: string) =>
		console.log(chalk.blue('ℹ ') + chalk.cyan(message)),
	success: (message: string) => console.log(chalk.green('✓ ') + message),
	warning: (message: string) => console.log(chalk.yellow('⚠ ') + message),
	error: (message: string) =>
		console.error(chalk.red('✗ ') + chalk.redBright(message)),
	highlight: (message: string) =>
		console.log(chalk.magenta('→ ') + chalk.bold(message)),
	process: (message: string) =>
		console.log(chalk.blue('⚙ ') + chalk.white(message)),
};

export default log;
