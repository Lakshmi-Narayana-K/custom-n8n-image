import { inject } from 'vue';
import { WorkflowIdKey } from '@/app/constants/injectionKeys';
import { useWorkflowIdFromRoute } from '@/app/composables/useProvideWorkflowId';

/**
 * Prefer `WorkflowIdKey` from WorkflowLayout / DemoLayout; fall back to route params
 * when inject is missing (async layout edges, HMR, or rare mount ordering).
 */
export function useInjectWorkflowId() {
	const injected = inject(WorkflowIdKey, null);
	if (injected != null) {
		return injected;
	}
	return useWorkflowIdFromRoute();
}
