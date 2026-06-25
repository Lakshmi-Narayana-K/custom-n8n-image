import type { ExecutionStatus, IRun } from 'n8n-workflow';

export type PerformanceErrorCategory = 'none' | 'workflow_error' | 'system_error' | 'unclassified';

/** n8n engine / orchestration failures — only evaluated when no node is attached. */
const N8N_ENGINE_INFRA_PATTERNS = [
	/too many clients/i,
	/connection pool/i,
	/SQLSTATE/i,
	/sequelize/i,
	/typeorm/i,
	/(ECONNREFUSED|ETIMEDOUT|ECONNRESET).*:(5432|5433|6379)/i,
	/\b(redis|bullmq|ioredis)\b.*(connect|refused|timeout|unavailable)/i,
	/ENOMEM|out of memory|JavaScript heap out of memory/i,
	/no space left on device|disk full/i,
	/container.*(restart|killed|oom)/i,
];

const ENGINE_RESOURCE_PATTERNS = [
	/worker (process|died|crashed)/i,
	/process exited/i,
	/uncaught exception/i,
];

function hasNodeContext(runData: IRun | undefined): boolean {
	const resultData = runData?.data?.resultData;
	if (!resultData) {
		return false;
	}

	const lastNodeExecuted = resultData.lastNodeExecuted;
	if (typeof lastNodeExecuted === 'string' && lastNodeExecuted.length > 0) {
		return true;
	}

	const error = resultData.error;
	if (!error || typeof error !== 'object') {
		return false;
	}

	if ('node' in error && error.node) {
		const node = error.node;
		if (typeof node === 'object' && node !== null) {
			if ('name' in node && typeof node.name === 'string' && node.name.length > 0) {
				return true;
			}
			if ('id' in node && node.id) {
				return true;
			}
		}
	}

	return false;
}

function matchesAnyPattern(message: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(message));
}

export function classifyExecutionErrorCategory(
	status: ExecutionStatus,
	runData: IRun | undefined,
): PerformanceErrorCategory {
	if (
		status === 'success' ||
		status === 'canceled' ||
		status === 'waiting' ||
		status === 'new' ||
		status === 'running' ||
		status === 'unknown'
	) {
		return 'none';
	}

	// Node-attached failures are always workflow errors, regardless of message wording.
	if (hasNodeContext(runData)) {
		return 'workflow_error';
	}

	if (status === 'crashed') {
		return 'system_error';
	}

	const error = runData?.data?.resultData?.error;
	if (!error) {
		return 'unclassified';
	}

	const message = typeof error.message === 'string' ? error.message : '';
	if (!message) {
		return 'unclassified';
	}

	if (matchesAnyPattern(message, N8N_ENGINE_INFRA_PATTERNS)) {
		return 'system_error';
	}

	if (matchesAnyPattern(message, ENGINE_RESOURCE_PATTERNS)) {
		return 'system_error';
	}

	return 'unclassified';
}
