const RECENT_API_TIMING_LIMIT = 250;
const RECENT_API_TIMING_TTL_MS = 120_000;

const SETTINGS_KEYWORDS = ['/settings'] as const;
const LAST_SUCCESSFUL_KEYWORDS = ['last-successful'] as const;
const NEW_WORKFLOW_KEYWORDS = ['/workflows/new'] as const;

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
	startedAt: number;
	apiTimings: ApiTiming[];
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

function matchesEndpoint(endpoint: string, keywords: readonly string[]): boolean {
	return keywords.some((keyword) => endpoint.includes(keyword));
}

function isExistingWorkflowFetchEndpoint(endpoint: string): boolean {
	return endpoint.includes('/workflows/') && !endpoint.includes('/workflows/new');
}

function requestStartedAt(timing: ApiTiming): number {
	return timing.recordedAt - timing.durationMs;
}

function findFirstTiming(timings: ApiTiming[], keywords: readonly string[]): ApiTiming | null {
	for (const timing of timings) {
		if (matchesEndpoint(timing.endpoint, keywords)) {
			return timing;
		}
	}
	return null;
}

function findLastTiming(timings: ApiTiming[], keywords: readonly string[]): ApiTiming | null {
	let last: ApiTiming | null = null;
	for (const timing of timings) {
		if (matchesEndpoint(timing.endpoint, keywords)) {
			last = timing;
		}
	}
	return last;
}

function findFirstExistingWorkflowFetch(timings: ApiTiming[]): ApiTiming | null {
	for (const timing of timings) {
		if (isExistingWorkflowFetchEndpoint(timing.endpoint)) {
			return timing;
		}
	}
	return null;
}

function resolveStartAt(timings: ApiTiming[], fallback: ApiTiming | null): number | null {
	const settings = findFirstTiming(timings, SETTINGS_KEYWORDS);
	if (settings) {
		return requestStartedAt(settings);
	}
	if (fallback) {
		return requestStartedAt(fallback);
	}
	return null;
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
		startedAt: activeScenario.startedAt,
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
 * Existing workflow: /settings request start → last-successful response end.
 * Falls back to existing-workflow fetch start when /settings was not called in this open.
 */
export function computeOpenWorkflowServerSideMs(timings: ApiTiming[]): number | null {
	if (!timings.length) {
		return null;
	}

	const lastSuccessful = findLastTiming(timings, LAST_SUCCESSFUL_KEYWORDS);
	if (!lastSuccessful) {
		return null;
	}

	const startAt = resolveStartAt(timings, findFirstExistingWorkflowFetch(timings));
	const endAt = lastSuccessful.recordedAt;

	if (startAt === null || endAt <= startAt) {
		return null;
	}

	return Math.round(endAt - startAt);
}

function findFirstExistsCheck(timings: ApiTiming[]): ApiTiming | null {
	for (const timing of timings) {
		if (timing.endpoint.includes('/exists')) {
			return timing;
		}
	}
	return null;
}

/**
 * New workflow: /settings request start → GET /workflows/new response end.
 * /settings is usually fetched at app boot before the scenario starts, so
 * falls back to the /workflows/{id}/exists check start — the first API fired
 * inside the open_workflow scenario window for a new workflow.
 */
export function computeNewWorkflowServerSideMs(timings: ApiTiming[]): number | null {
	if (!timings.length) {
		return null;
	}

	const newWorkflow = findLastTiming(timings, NEW_WORKFLOW_KEYWORDS);
	if (!newWorkflow) {
		return null;
	}

	const settings = findFirstTiming(timings, SETTINGS_KEYWORDS);
	const existsCheck = findFirstExistsCheck(timings);
	const startAnchor = settings ?? existsCheck;
	if (!startAnchor) {
		return null;
	}

	const startAt = requestStartedAt(startAnchor);
	const endAt = newWorkflow.recordedAt;

	if (endAt <= startAt) {
		return null;
	}

	return Math.round(endAt - startAt);
}
