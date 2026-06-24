import { classifyExecutionErrorCategory } from '@/services/performance-error-category';
import type { IRun } from 'n8n-workflow';

describe('classifyExecutionErrorCategory', () => {
	it('returns none for success', () => {
		expect(classifyExecutionErrorCategory('success', undefined)).toBe('none');
	});

	it('returns system_error for crashed', () => {
		expect(classifyExecutionErrorCategory('crashed', undefined)).toBe('system_error');
	});

	it('returns workflow_error when node context exists', () => {
		const runData = {
			data: {
				resultData: {
					error: {
						message: 'Node failed',
						node: { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' },
					},
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('workflow_error');
	});

	it('returns system_error for connection timeout without node', () => {
		const runData = {
			data: {
				resultData: {
					error: {
						message: 'connection pool timeout',
					},
				},
			},
		} as unknown as IRun;
		expect(classifyExecutionErrorCategory('error', runData)).toBe('system_error');
	});
});
