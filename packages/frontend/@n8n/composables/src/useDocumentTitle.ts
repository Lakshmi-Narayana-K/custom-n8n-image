import { ref, type Ref } from 'vue';

const DEFAULT_TITLE = 'n8n';
const DEFAULT_TAGLINE = 'Workflow Automation';

export type WorkflowTitleStatus =
	| 'EXECUTING'
	| 'IDLE'
	| 'ERROR'
	| 'DEBUG'
	| 'AI_BUILDING'
	| 'AI_DONE';

export interface UseDocumentTitleOptions {
	/**
	 * The release channel (e.g., 'stable', 'beta', 'dev').
	 * If not provided or 'stable', the title will be 'n8n'.
	 * Otherwise, it will be 'n8n[CHANNEL]'.
	 */
	releaseChannel?: string;
	/**
	 * Optional window reference for setting the document title.
	 * Useful for pop-out windows.
	 */
	windowRef?: Ref<Window | undefined>;
}

export function useDocumentTitle(options: UseDocumentTitleOptions = {}) {
	const { windowRef } = options;
	const suffix = DEFAULT_TITLE;

	const currentState = ref<WorkflowTitleStatus | undefined>(undefined);

	const set = (title: string) => {
		const sections = [title || DEFAULT_TAGLINE, suffix];
		(windowRef?.value?.document ?? document).title = sections.join(' - ');
	};

	const reset = () => {
		currentState.value = undefined;
		set('');
	};

	const setDocumentTitle = (workflowName: string, status: WorkflowTitleStatus) => {
		currentState.value = status;
		let prefix = '⚠️';
		if (status === 'EXECUTING') {
			prefix = '🔄';
		} else if (status === 'IDLE') {
			prefix = '▶️';
		} else if (status === 'AI_BUILDING') {
			prefix = '[Building]';
		} else if (status === 'AI_DONE') {
			prefix = '[Done]';
		}
		set(`${prefix} ${workflowName}`);
	};

	const getDocumentState = () => currentState.value;

	return { set, reset, setDocumentTitle, getDocumentState };
}
