import { z } from 'zod';

import { Z } from '../../zod-class';

export class PerformanceEventRequestDto extends Z.class({
	event_name: z.string(),
	duration_ms: z.number().finite(),
	workflow_id: z.string().optional(),
	project_id: z.string().optional(),
	node_type: z.string().optional(),
	node_count: z.number().optional(),
	fetch_duration_ms: z.number().optional(),
	workspace_init_duration_ms: z.number().optional(),
	render_duration_ms: z.number().optional(),
	last_successful_duration_ms: z.number().optional(),
	server_side_duration_ms: z.number().optional(),
	measurement: z.string().optional(),
	settings_ms: z.number().optional(),
	parallel_ms: z.number().optional(),
	credentials_ms: z.number().optional(),
	workflow_fetch_ms: z.number().optional(),
	last_successful_ms: z.number().optional(),
}) {}
