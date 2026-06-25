import { classifyExecutionErrorCategory } from '@/services/performance-error-category';
import type { IRun } from 'n8n-workflow';

describe('classifyExecutionErrorCategory', () => {
	it('returns none for success', () => {
		expect(classifyExecutionErrorCategory('success', undefined)).toBe('none');
	});

	it('returns workflow_error when error.node is present', () => {
		const runData = {
			data: {
				resultData: {
					error: {
						message: 'connection pool timeout',
						node: { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' },
					},
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('workflow_error');
	});

	it('returns workflow_error when lastNodeExecuted is set even if message looks infra-related', () => {
		const runData = {
			data: {
				resultData: {
					lastNodeExecuted: 'Postgres',
					error: {
						message: 'ECONNREFUSED database timeout',
					},
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('workflow_error');
	});

	it('returns workflow_error when lastNodeExecuted is set without an error object', () => {
		const runData = {
			data: {
				resultData: {
					lastNodeExecuted: 'Code',
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('workflow_error');
	});

	it('returns system_error for crashed without node context', () => {
		expect(classifyExecutionErrorCategory('crashed', undefined)).toBe('system_error');
	});

	it('returns system_error for orchestration infra failures without node context', () => {
		const runData = {
			data: {
				resultData: {
					error: {
						message: 'sorry, too many clients already',
					},
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('system_error');
	});

	it('returns unclassified for ambiguous failures without node context', () => {
		const runData = {
			data: {
				resultData: {
					error: {
						message: 'something unexpected happened',
					},
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('unclassified');
	});

	it('returns unclassified when there is no error object and no node context', () => {
		const runData = {
			data: {
				resultData: {},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('unclassified');
	});
});
