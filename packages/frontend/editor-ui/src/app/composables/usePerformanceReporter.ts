import { useRootStore } from '@n8n/stores/useRootStore';
import { makeRestApiRequest } from '@n8n/rest-api-client';

export type PerformanceEventPayload = {
	event_name: string;
	duration_ms: number;
	workflow_id?: string;
	node_type?: string;
	node_count?: number;
	fetch_duration_ms?: number;
	workspace_init_duration_ms?: number;
	render_duration_ms?: number;
	last_successful_duration_ms?: number;
	server_side_duration_ms?: number;
	measurement?: string;
	settings_ms?: number;
	parallel_ms?: number;
	credentials_ms?: number;
	workflow_fetch_ms?: number;
	last_successful_ms?: number;
};

export function reportPerformanceEvent(payload: PerformanceEventPayload): void {
	const rootStore = useRootStore();
	void makeRestApiRequest(rootStore.restApiContext, 'POST', '/performance-events', payload).catch(
		() => {
			// Fire-and-forget — dashboard metrics must not affect editor UX
		},
	);
}
