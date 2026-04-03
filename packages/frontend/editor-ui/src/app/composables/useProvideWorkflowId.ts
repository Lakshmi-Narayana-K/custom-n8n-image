import { computed, provide, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
import { VIEWS } from '@/app/constants';
import { WorkflowIdKey } from '@/app/constants/injectionKeys';

/**
 * Resolves the workflow id segment from the current route (same rules everywhere:
 * demo, template import uses `id`, standard editor uses `name`).
 */
export function useWorkflowIdFromRoute(): ComputedRef<string> {
	const route = useRoute();

	return computed(() => {
		if (route.name === VIEWS.DEMO) return 'demo';

		if (route.name === VIEWS.TEMPLATE_IMPORT) {
			const id = route.params.id;
			return (Array.isArray(id) ? id[0] : id) ?? '';
		}

		const name = route.params.name;
		return (Array.isArray(name) ? name[0] : name) ?? '';
	});
}

export function useProvideWorkflowId() {
	const workflowId = useWorkflowIdFromRoute();

	provide(WorkflowIdKey, workflowId);

	return workflowId;
}
