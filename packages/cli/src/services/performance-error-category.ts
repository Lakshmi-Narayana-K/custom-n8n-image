import type { ExecutionStatus, IRun } from 'n8n-workflow';

export type PerformanceErrorCategory = 'none' | 'workflow_error' | 'system_error';

const SYSTEM_ERROR_PATTERNS = [
	/ECONNREFUSED/i,
	/ETIMEDOUT/i,
	/timeout/i,
	/connection pool/i,
	/too many clients/i,
	/ECONNRESET/i,
	/socket hang up/i,
	/database/i,
	/postgres/i,
	/SQLSTATE/i,
];

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

	if (status === 'crashed') {
		return 'system_error';
	}

	const error = runData?.data.resultData.error;
	if (!error) {
		return 'system_error';
	}

	const message = error.message ?? '';
	if (SYSTEM_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
		return 'system_error';
	}

	if (!('node' in error) || !error.node) {
		return 'system_error';
	}

	return 'workflow_error';
}
