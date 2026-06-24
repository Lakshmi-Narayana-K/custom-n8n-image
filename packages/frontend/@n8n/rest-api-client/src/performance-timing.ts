const RECENT_API_TIMING_LIMIT = 250;
const RECENT_API_TIMING_TTL_MS = 120_000;

const OPEN_WORKFLOW_PARALLEL_ENDPOINTS = [
	'module-settings',
	'my-projects',
	'projects/count',
	'data-tables-global/limits',
	'projects/personal',
	'/roles',
] as const;

type ApiTiming = {
	endpoint: string;
	durationMs: number;
	recordedAt: number;
};

type ActiveScenario = {
	name: string;
	startedAt: number;
	apiTimings: ApiTiming[];
};

export type PerformanceScenarioResult = {
	scenario: string;
	wallClockMs: number;
	apiTimings: ApiTiming[];
};

export type OpenWorkflowPhaseDurations = {
	settings_ms: number | null;
	parallel_ms: number | null;
	credentials_ms: number | null;
	workflow_fetch_ms: number | null;
	last_successful_ms: number | null;
};

let activeScenario: ActiveScenario | null = null;
const recentApiTimings: ApiTiming[] = [];

function pruneRecentApiTimings(now: number): void {
	while (recentApiTimings.length > RECENT_API_TIMING_LIMIT) {
		recentApiTimings.shift();
	}

	while (
		recentApiTimings.length > 0 &&
		now - recentApiTimings[0].recordedAt > RECENT_API_TIMING_TTL_MS
	) {
		recentApiTimings.shift();
	}
}

function mergeTimingsForOpenWorkflow(timings: ApiTiming[]): ApiTiming[] {
	pruneRecentApiTimings(performance.now());
	return [...recentApiTimings, ...timings];
}

function firstDuration(timings: ApiTiming[], keywords: readonly string[]): number | null {
	for (const timing of timings) {
		if (keywords.some((keyword) => timing.endpoint.includes(keyword))) {
			return timing.durationMs;
		}
	}
	return null;
}

function maxDuration(timings: ApiTiming[], keywords: readonly string[]): number | null {
	const values = timings
		.filter((timing) => keywords.some((keyword) => timing.endpoint.includes(keyword)))
		.map((timing) => timing.durationMs);

	return values.length > 0 ? Math.max(...values) : null;
}

export function startPerformanceScenario(name: string): void {
	activeScenario = {
		name,
		startedAt: performance.now(),
		apiTimings: [],
	};
}

export function endPerformanceScenario(): PerformanceScenarioResult | null {
	if (!activeScenario) {
		return null;
	}

	const result: PerformanceScenarioResult = {
		scenario: activeScenario.name,
		wallClockMs: Math.round(performance.now() - activeScenario.startedAt),
		apiTimings: activeScenario.apiTimings,
	};
	activeScenario = null;
	return result;
}

export function recordApiTiming(endpoint: string, durationMs: number): void {
	if (durationMs < 0) {
		return;
	}

	const timing: ApiTiming = {
		endpoint,
		durationMs: Math.round(durationMs),
		recordedAt: performance.now(),
	};
	recentApiTimings.push(timing);
	pruneRecentApiTimings(timing.recordedAt);

	if (!activeScenario) {
		return;
	}

	activeScenario.apiTimings.push(timing);
}

/**
 * Mirrors generate_report.py server_side_open_wf(): sum sequential API phase
 * bottlenecks (settings + parallel group + credentials + workflow + last-successful).
 */
export function computeOpenWorkflowServerSideMs(timings: ApiTiming[]): number | null {
	const merged = mergeTimingsForOpenWorkflow(timings);
	const settings = firstDuration(merged, ['/settings']);
	const parallel = maxDuration(merged, OPEN_WORKFLOW_PARALLEL_ENDPOINTS);
	const credentials = maxDuration(merged, ['credentials/for-workflow', 'active-workflows']);
	const workflowFetch = firstDuration(merged, ['/workflows/']);
	const lastSuccessful = firstDuration(merged, ['last-successful']);

	if (
		settings === null ||
		parallel === null ||
		credentials === null ||
		workflowFetch === null ||
		lastSuccessful === null
	) {
		return null;
	}

	return settings + parallel + credentials + workflowFetch + lastSuccessful;
}

export function getOpenWorkflowPhaseDurationsMs(timings: ApiTiming[]): OpenWorkflowPhaseDurations {
	const merged = mergeTimingsForOpenWorkflow(timings);
	return {
		settings_ms: firstDuration(merged, ['/settings']),
		parallel_ms: maxDuration(merged, OPEN_WORKFLOW_PARALLEL_ENDPOINTS),
		credentials_ms: maxDuration(merged, ['credentials/for-workflow', 'active-workflows']),
		workflow_fetch_ms: firstDuration(merged, ['/workflows/']),
		last_successful_ms: firstDuration(merged, ['last-successful']),
	};
}
