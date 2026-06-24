import { Service } from '@n8n/di';
import { Logger } from '@n8n/backend-common';

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
	user_id?: string;
	status?: string;
	error_category?: string;
};

@Service()
export class PerformanceMetricsService {
	constructor(private readonly logger: Logger) {}

	record(payload: PerformanceEventPayload): void {
		this.logger.info('n8n performance event', {
			type: 'n8n_performance',
			event_name: payload.event_name,
			duration_ms: payload.duration_ms,
			workflow_id: payload.workflow_id,
			node_type: payload.node_type,
			node_count: payload.node_count,
			fetch_duration_ms: payload.fetch_duration_ms,
			workspace_init_duration_ms: payload.workspace_init_duration_ms,
			render_duration_ms: payload.render_duration_ms,
			last_successful_duration_ms: payload.last_successful_duration_ms,
			server_side_duration_ms: payload.server_side_duration_ms,
			measurement: payload.measurement,
			settings_ms: payload.settings_ms,
			parallel_ms: payload.parallel_ms,
			credentials_ms: payload.credentials_ms,
			workflow_fetch_ms: payload.workflow_fetch_ms,
			last_successful_ms: payload.last_successful_ms,
			user_id: payload.user_id,
			status: payload.status,
			error_category: payload.error_category,
		});
	}
}
