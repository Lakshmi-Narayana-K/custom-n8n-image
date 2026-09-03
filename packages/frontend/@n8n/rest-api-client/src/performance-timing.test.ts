import { describe, expect, it } from 'vitest';

import {
	computeNewWorkflowServerSideMs,
	computeOpenWorkflowMeasurement,
	computeOpenWorkflowServerSideMs,
	computeOpenWorkflowWallClockMs,
	endPerformanceScenario,
	pausePerformanceScenario,
	resumePerformanceScenario,
	startPerformanceScenario,
} from './performance-timing';

function timing(endpoint: string, durationMs: number, recordedAt: number) {
	return { endpoint, durationMs, recordedAt };
}

const WORKFLOW_ID = 'abc';

describe('computeOpenWorkflowServerSideMs', () => {
	it('returns settings start to workflow-specific last-successful end', () => {
		const timings = [
			timing('/rest/settings', 100, 1100),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 300, 1500),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 50, 2000),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBe(1000);
	});

	it('falls back to workflow fetch start when settings is absent', () => {
		const timings = [
			timing(`/rest/workflows/${WORKFLOW_ID}`, 400, 1400),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 80, 1800),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBe(800);
	});

	it('ignores non-critical APIs such as parallel bootstrap calls', () => {
		const timings = [
			timing('/rest/settings', 50, 500),
			timing('/rest/projects/my-projects', 12_480, 13_000),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 200, 900),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 40, 1200),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBe(750);
	});

	it('returns null without workflow-specific last-successful', () => {
		const timings = [timing('/rest/settings', 100, 1100)];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBeNull();
	});

	it('returns null when workflow-specific last-successful ends before the start anchor', () => {
		const timings = [
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 50, 500),
			timing('/rest/settings', 100, 1100),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBeNull();
	});

	it('does not treat /workflows/new as an existing workflow fetch fallback', () => {
		const timings = [
			timing('/rest/workflows/new', 200, 1200),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 40, 1500),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBeNull();
	});

	it('ignores another workflow last-successful as the end anchor', () => {
		const timings = [
			timing('/rest/settings', 100, 1000),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 90, 1190),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 30, 1300),
			timing('/rest/workflows/other/executions/last-successful', 30, 55_300),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBe(400);
	});

	it('excludes OAuth popup/tab round-trips from the critical path', () => {
		const timings = [
			timing('/rest/settings', 100, 1000),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 90, 1190),
			timing('/rest/oauth2-credential/auth', 20, 2210),
			timing('/rest/oauth2-credential/callback', 40, 8210),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 30, 8300),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBe(1380);
	});
});

describe('computeOpenWorkflowMeasurement', () => {
	it('returns api and gap breakdown for the workflow critical path', () => {
		const timings = [
			timing('/rest/settings', 100, 1100),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 300, 1500),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 50, 2000),
		];

		expect(computeOpenWorkflowMeasurement(timings, WORKFLOW_ID)).toEqual({
			criticalPathMs: 1000,
			apiTotalMs: 450,
			gapMs: 550,
			oauthExcludedMs: 0,
			pauseExcludedMs: 0,
		});
	});

	it('excludes OAuth popup pause intervals from the critical path', () => {
		const timings = [
			timing('/rest/settings', 100, 1000),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 90, 1190),
			timing('/rest/oauth2-credential/auth', 20, 2210),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 30, 8300),
		];
		const pauseIntervals = [{ start: 2210, end: 8210 }];

		expect(computeOpenWorkflowMeasurement(timings, WORKFLOW_ID, pauseIntervals)).toEqual({
			criticalPathMs: 1400,
			apiTotalMs: 220,
			gapMs: 1180,
			oauthExcludedMs: 0,
			pauseExcludedMs: 6000,
		});
	});
});

describe('performance scenario pause', () => {
	it('records pause intervals on resume and applies them to wall clock', () => {
		startPerformanceScenario('open_workflow');
		pausePerformanceScenario();
		resumePerformanceScenario();
		const result = endPerformanceScenario();

		expect(result?.pauseIntervals).toHaveLength(1);
		expect(result?.pauseIntervals[0].end).toBeGreaterThanOrEqual(
			result?.pauseIntervals[0].start ?? 0,
		);
	});
});

describe('computeOpenWorkflowWallClockMs', () => {
	it('subtracts OAuth intervals from raw wall clock', () => {
		const timings = [
			timing('/rest/oauth2-credential/auth', 0, 1000),
			timing('/rest/oauth2-credential/callback', 0, 4000),
		];

		expect(computeOpenWorkflowWallClockMs(timings, 0, 5000)).toBe(2000);
	});

	it('subtracts popup pause intervals from raw wall clock', () => {
		expect(computeOpenWorkflowWallClockMs([], 0, 10_000, [{ start: 1000, end: 8000 }])).toBe(3000);
	});
});

describe('workflow fetch endpoint matching', () => {
	it('does not treat a longer workflow id as a fetch for a shorter id prefix', () => {
		const timings = [
			timing('/rest/settings', 100, 1000),
			timing('/rest/workflows/abc123', 100, 1200),
			timing('/rest/workflows/abc/executions/last-successful', 30, 1500),
		];

		expect(computeOpenWorkflowServerSideMs(timings, 'abc')).toBe(600);
	});

	it('does not treat activate calls as the workflow fetch start anchor', () => {
		const timings = [
			timing('/rest/settings', 100, 1000),
			timing(`/rest/workflows/${WORKFLOW_ID}/activate`, 50, 1200),
			timing(`/rest/workflows/${WORKFLOW_ID}`, 90, 1400),
			timing(`/rest/workflows/${WORKFLOW_ID}/executions/last-successful`, 30, 1600),
		];

		expect(computeOpenWorkflowServerSideMs(timings, WORKFLOW_ID)).toBe(700);
	});
});

describe('computeNewWorkflowServerSideMs', () => {
	it('returns settings start to /workflows/new end', () => {
		const timings = [timing('/rest/settings', 80, 1080), timing('/rest/workflows/new', 120, 1500)];

		expect(computeNewWorkflowServerSideMs(timings)).toBe(500);
	});

	it('falls back to /exists start when settings was fetched before scenario', () => {
		const timings = [
			timing('/rest/workflows/abc/exists', 40, 1040),
			timing('/rest/workflows/new', 100, 1300),
		];

		// start = 1040 - 40 = 1000, end = 1300 → 300ms
		expect(computeNewWorkflowServerSideMs(timings)).toBe(300);
	});

	it('returns null when neither settings nor exists check is present', () => {
		const timings = [timing('/rest/workflows/new', 100, 1300)];

		expect(computeNewWorkflowServerSideMs(timings)).toBeNull();
	});
});
