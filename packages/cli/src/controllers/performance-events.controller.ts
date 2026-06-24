import { AuthenticatedRequest } from '@n8n/db';
import { PerformanceEventRequestDto } from '@n8n/api-types';
import { Body, Post, RestController } from '@n8n/decorators';
import { Response } from 'express';

import { PerformanceMetricsService } from '@/services/performance-metrics.service';

@RestController('/performance-events')
export class PerformanceEventsController {
	constructor(private readonly performanceMetricsService: PerformanceMetricsService) {}

	@Post('/')
	async recordEvent(
		req: AuthenticatedRequest,
		res: Response,
		@Body payload: PerformanceEventRequestDto,
	): Promise<void> {
		this.performanceMetricsService.record({
			...payload,
			duration_ms: Math.round(payload.duration_ms),
			user_id: req.user.id,
		});

		res.status(204).send();
	}
}
