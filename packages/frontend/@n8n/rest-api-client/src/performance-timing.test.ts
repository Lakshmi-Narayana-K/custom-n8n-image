import { describe, expect, it } from 'vitest';

import {
	computeNewWorkflowServerSideMs,
	computeOpenWorkflowServerSideMs,
} from './performance-timing';

function timing(endpoint: string, durationMs: number, recordedAt: number) {
	return { endpoint, durationMs, recordedAt };
}

describe('computeOpenWorkflowServerSideMs', () => {
	it('returns settings start to last-successful end', () => {
		const timings = [
			timing('GET /rest/settings', 100, 1100),
			timing('GET /rest/workflows/abc', 300, 1500),
			timing('GET /rest/executions/last-successful', 50, 2000),
		];

		expect(computeOpenWorkflowServerSideMs(timings)).toBe(1000);
	});

	it('falls back to workflow fetch start when settings is absent', () => {
		const timings = [
			timing('GET /rest/workflows/abc', 400, 1400),
			timing('GET /rest/executions/last-successful', 80, 1800),
		];

		expect(computeOpenWorkflowServerSideMs(timings)).toBe(800);
	});

	it('ignores non-critical APIs such as parallel bootstrap calls', () => {
		const timings = [
			timing('GET /rest/settings', 50, 500),
			timing('GET /rest/projects/my-projects', 12_480, 13_000),
			timing('GET /rest/workflows/abc', 200, 900),
			timing('GET /rest/executions/last-successful', 40, 1200),
		];

		expect(computeOpenWorkflowServerSideMs(timings)).toBe(750);
	});

	it('returns null without last-successful', () => {
		const timings = [timing('GET /rest/settings', 100, 1100)];

		expect(computeOpenWorkflowServerSideMs(timings)).toBeNull();
	});

	it('returns null when last-successful ends before the start anchor', () => {
		const timings = [
			timing('GET /rest/executions/last-successful', 50, 500),
			timing('GET /rest/settings', 100, 1100),
		];

		expect(computeOpenWorkflowServerSideMs(timings)).toBeNull();
	});

	it('does not treat /workflows/new as an existing workflow fetch fallback', () => {
		const timings = [
			timing('GET /rest/workflows/new', 200, 1200),
			timing('GET /rest/executions/last-successful', 40, 1500),
		];

		expect(computeOpenWorkflowServerSideMs(timings)).toBeNull();
	});
});

describe('computeNewWorkflowServerSideMs', () => {
	it('returns settings start to /workflows/new end', () => {
		const timings = [
			timing('GET /rest/settings', 80, 1080),
			timing('GET /rest/workflows/new', 120, 1500),
		];

		expect(computeNewWorkflowServerSideMs(timings)).toBe(500);
	});

	it('falls back to /exists start when settings was fetched before scenario', () => {
		const timings = [
			timing('GET /rest/workflows/abc/exists', 40, 1040),
			timing('GET /rest/workflows/new', 100, 1300),
		];

		// start = 1040 - 40 = 1000, end = 1300 → 300ms
		expect(computeNewWorkflowServerSideMs(timings)).toBe(300);
	});

	it('returns null when neither settings nor exists check is present', () => {
		const timings = [timing('GET /rest/workflows/new', 100, 1300)];

		expect(computeNewWorkflowServerSideMs(timings)).toBeNull();
	});
});
