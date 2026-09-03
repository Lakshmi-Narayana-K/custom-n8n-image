const RECENT_API_TIMING_LIMIT = 250;
const RECENT_API_TIMING_TTL_MS = 120_000;

const SETTINGS_KEYWORDS = ['/settings'] as const;
const NEW_WORKFLOW_KEYWORDS = ['/workflows/new'] as const;
const OAUTH_AUTH_KEYWORDS = ['/oauth1-credential/auth', '/oauth2-credential/auth'] as const;
const OAUTH_CALLBACK_KEYWORDS = [
	'/oauth1-credential/callback',
	'/oauth2-credential/callback',
] as const;

type ApiTiming = {
	endpoint: string;
	durationMs: number;
	recordedAt: number;
};

type PauseInterval = {
	start: number;
	end: number;
};

type ActiveScenario = {
	name: string;
	startedAt: number;
	apiTimings: ApiTiming[];
	pauseStartedAt: number | null;
	pauseIntervals: PauseInterval[];
};

export type PerformanceScenarioResult = {
	scenario: string;
	wallClockMs: number;
	startedAt: number;
	apiTimings: ApiTiming[];
	pauseIntervals: PauseInterval[];
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

function isWorkflowFetchEndpoint(endpoint: string, workflowId: string): boolean {
	const marker = `/workflows/${workflowId}`;
	const markerIndex = endpoint.indexOf(marker);
	if (markerIndex === -1) {
		return false;
	}

	const rest = endpoint.slice(markerIndex + marker.length);
	return rest === '' || rest.startsWith('?');
}

function isWorkflowLastSuccessfulEndpoint(endpoint: string, workflowId: string): boolean {
	return endpoint.includes(`/workflows/${workflowId}/executions/last-successful`);
}

function findFirstWorkflowFetch(timings: ApiTiming[], workflowId: string): ApiTiming | null {
	for (const timing of timings) {
		if (isWorkflowFetchEndpoint(timing.endpoint, workflowId)) {
			return timing;
		}
	}
	return null;
}

function findLastWorkflowLastSuccessful(
	timings: ApiTiming[],
	workflowId: string,
): ApiTiming | null {
	let last: ApiTiming | null = null;
	for (const timing of timings) {
		if (isWorkflowLastSuccessfulEndpoint(timing.endpoint, workflowId)) {
			last = timing;
		}
	}
	return last;
}

function computeOAuthExcludedMs(
	timings: ApiTiming[],
	windowStart: number,
	windowEnd: number,
): number {
	let excluded = 0;
	let authStart: number | null = null;

	for (const timing of timings) {
		if (matchesEndpoint(timing.endpoint, OAUTH_AUTH_KEYWORDS)) {
			authStart = requestStartedAt(timing);
			continue;
		}

		if (authStart === null || !matchesEndpoint(timing.endpoint, OAUTH_CALLBACK_KEYWORDS)) {
			continue;
		}

		const intervalStart = Math.max(authStart, windowStart);
		const intervalEnd = Math.min(timing.recordedAt, windowEnd);
		if (intervalEnd > intervalStart) {
			excluded += intervalEnd - intervalStart;
		}
		authStart = null;
	}

	return Math.round(excluded);
}

function computePauseExcludedMs(
	pauseIntervals: PauseInterval[],
	windowStart: number,
	windowEnd: number,
): number {
	let excluded = 0;

	for (const { start, end } of pauseIntervals) {
		const intervalStart = Math.max(start, windowStart);
		const intervalEnd = Math.min(end, windowEnd);
		if (intervalEnd > intervalStart) {
			excluded += intervalEnd - intervalStart;
		}
	}

	return Math.round(excluded);
}

function finalizePauseIntervals(scenario: ActiveScenario): PauseInterval[] {
	if (scenario.pauseStartedAt !== null) {
		scenario.pauseIntervals.push({
			start: scenario.pauseStartedAt,
			end: performance.now(),
		});
		scenario.pauseStartedAt = null;
	}

	return scenario.pauseIntervals;
}

export type OpenWorkflowMeasurement = {
	criticalPathMs: number;
	apiTotalMs: number;
	gapMs: number;
	oauthExcludedMs: number;
	pauseExcludedMs: number;
};

function sumIncludedApiDurationMs(
	timings: ApiTiming[],
	workflowId: string,
	windowStart: number,
	windowEnd: number,
): number {
	let total = 0;
	for (const timing of timings) {
		const requestStart = requestStartedAt(timing);
		if (requestStart < windowStart || timing.recordedAt > windowEnd) {
			continue;
		}

		const isIncluded =
			matchesEndpoint(timing.endpoint, SETTINGS_KEYWORDS) ||
			isWorkflowFetchEndpoint(timing.endpoint, workflowId) ||
			isWorkflowLastSuccessfulEndpoint(timing.endpoint, workflowId);

		if (isIncluded) {
			total += timing.durationMs;
		}
	}
	return total;
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
		pauseStartedAt: null,
		pauseIntervals: [],
	};
}

export function pausePerformanceScenario(): void {
	if (!activeScenario || activeScenario.pauseStartedAt !== null) {
		return;
	}

	activeScenario.pauseStartedAt = performance.now();
}

export function resumePerformanceScenario(): void {
	if (!activeScenario || activeScenario.pauseStartedAt === null) {
		return;
	}

	activeScenario.pauseIntervals.push({
		start: activeScenario.pauseStartedAt,
		end: performance.now(),
	});
	activeScenario.pauseStartedAt = null;
}

export function endPerformanceScenario(): PerformanceScenarioResult | null {
	if (!activeScenario) {
		return null;
	}

	const pauseIntervals = finalizePauseIntervals(activeScenario);
	const result: PerformanceScenarioResult = {
		scenario: activeScenario.name,
		wallClockMs: Math.round(performance.now() - activeScenario.startedAt),
		startedAt: activeScenario.startedAt,
		apiTimings: activeScenario.apiTimings,
		pauseIntervals,
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
 * Existing workflow critical path for a specific workflow:
 * /settings request start (or that workflow's fetch start) → that workflow's
 * /executions/last-successful response end.
 *
 * Excludes other workflows' last-successful calls and OAuth popup/tab round-trips.
 */
export function computeOpenWorkflowMeasurement(
	timings: ApiTiming[],
	workflowId: string,
	pauseIntervals: PauseInterval[] = [],
): OpenWorkflowMeasurement | null {
	if (!timings.length || !workflowId) {
		return null;
	}

	const lastSuccessful = findLastWorkflowLastSuccessful(timings, workflowId);
	if (!lastSuccessful) {
		return null;
	}

	const startAt = resolveStartAt(timings, findFirstWorkflowFetch(timings, workflowId));
	const endAt = lastSuccessful.recordedAt;

	if (startAt === null || endAt <= startAt) {
		return null;
	}

	const oauthExcludedMs = computeOAuthExcludedMs(timings, startAt, endAt);
	const pauseExcludedMs = computePauseExcludedMs(pauseIntervals, startAt, endAt);
	const criticalPathMs = Math.max(
		0,
		Math.round(endAt - startAt - oauthExcludedMs - pauseExcludedMs),
	);
	const apiTotalMs = sumIncludedApiDurationMs(timings, workflowId, startAt, endAt);

	return {
		criticalPathMs,
		apiTotalMs,
		gapMs: Math.max(0, criticalPathMs - apiTotalMs),
		oauthExcludedMs,
		pauseExcludedMs,
	};
}

export function computeOpenWorkflowServerSideMs(
	timings: ApiTiming[],
	workflowId: string,
	pauseIntervals: PauseInterval[] = [],
): number | null {
	return (
		computeOpenWorkflowMeasurement(timings, workflowId, pauseIntervals)?.criticalPathMs ?? null
	);
}

export function computeOpenWorkflowWallClockMs(
	timings: ApiTiming[],
	scenarioStart: number,
	rawWallClockMs: number,
	pauseIntervals: PauseInterval[] = [],
): number {
	const windowEnd = scenarioStart + rawWallClockMs;
	const oauthExcludedMs = computeOAuthExcludedMs(timings, scenarioStart, windowEnd);
	const pauseExcludedMs = computePauseExcludedMs(pauseIntervals, scenarioStart, windowEnd);
	return Math.max(0, rawWallClockMs - oauthExcludedMs - pauseExcludedMs);
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
