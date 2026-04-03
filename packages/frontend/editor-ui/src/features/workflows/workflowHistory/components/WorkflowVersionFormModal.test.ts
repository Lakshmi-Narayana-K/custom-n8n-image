import { createTestingPinia } from '@pinia/testing';
import { createComponentRenderer } from '@/__tests__/render';
import { cleanup, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { createEventBus } from '@n8n/utils/event-bus';
import { nextTick } from 'vue';
import { getActivePinia } from 'pinia';
import WorkflowVersionFormModal, {
	type WorkflowVersionFormModalEventBusEvents,
} from './WorkflowVersionFormModal.vue';
import { STORES } from '@n8n/stores';
import { useWorkflowsStore } from '@/app/stores/workflows.store';
import { useSettingsStore } from '@/app/stores/settings.store';

const TEST_MODAL_KEY = 'test-modal';

const renderComponent = createComponentRenderer(WorkflowVersionFormModal, {
	pinia: createTestingPinia({
		stubActions: false,
		initialState: {
			[STORES.UI]: {
				modalsById: {
					[TEST_MODAL_KEY]: {
						open: true,
					},
				},
				modalStack: [TEST_MODAL_KEY],
			},
			[STORES.SETTINGS]: {
				settings: {
					envFeatureFlags: {},
				},
			},
		},
	}),
	global: {
		stubs: {
			Modal: {
				template: '<div><slot name="header" /><slot name="content" /><slot name="footer" /></div>',
				props: ['name', 'eventBus'],
				mounted() {
					this.eventBus?.emit('opened');
				},
			},
			N8nTooltip: {
				template: '<div><slot /></div>',
			},
			WorkflowVersionForm: {
				template: `
					<div>
						<input
							:data-test-id="versionNameTestId"
							:disabled="disabled"
							:value="versionName"
							@input="$emit('update:versionName', $event.target.value)"
						/>
						<textarea
							:data-test-id="descriptionTestId"
							:disabled="disabled"
							:value="description"
							@input="$emit('update:description', $event.target.value)"
						/>
					</div>
				`,
				props: ['versionName', 'description', 'versionNameTestId', 'descriptionTestId', 'disabled'],
				methods: {
					focusInput: vi.fn(),
				},
			},
		},
	},
});

describe('WorkflowVersionFormModal', () => {
	afterEach(() => {
		cleanup();
		const pinia = getActivePinia();
		if (pinia) {
			const settingsStore = useSettingsStore();
			settingsStore.settings.envFeatureFlags = {};
			const workflowsStore = useWorkflowsStore();
			workflowsStore.setWorkflowNxtwavePublish(undefined);
		}
	});

	it('should generate version name from versionId if not provided', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: '12345678abcd',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(() => {
			const input = getByTestId(`${TEST_MODAL_KEY}-version-name-input`);
			expect(input).toHaveValue('Version 12345678');
		});
	});

	it('should use provided versionName if available', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: '12345678abcd',
					versionName: 'Custom Version Name',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(() => {
			const input = getByTestId(`${TEST_MODAL_KEY}-version-name-input`);
			expect(input).toHaveValue('Custom Version Name');
		});
	});

	it('should use provided description if available', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: '12345678abcd',
					description: 'Custom description',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(() => {
			const textarea = getByTestId(`${TEST_MODAL_KEY}-description-input`);
			expect(textarea).toHaveValue('Custom description');
		});
	});

	it('should emit submit event with correct data when submit button is clicked', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const submitHandler = vi.fn();
		eventBus.on('submit', submitHandler);

		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: 'Test Version',
					description: 'Test Description',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(async () => {
			const submitButton = getByTestId(`${TEST_MODAL_KEY}-submit-button`);
			await userEvent.click(submitButton);
		});

		expect(submitHandler).toHaveBeenCalledWith({
			versionId: 'version-123',
			name: 'Test Version',
			description: 'Test Description',
		});
	});

	it('should emit cancel event when cancel button is clicked', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const cancelHandler = vi.fn();
		eventBus.on('cancel', cancelHandler);

		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(async () => {
			const cancelButton = getByTestId(`${TEST_MODAL_KEY}-cancel-button`);
			await userEvent.click(cancelButton);

			expect(cancelHandler).toHaveBeenCalled();
		});
	});

	it('should disable submit button when version name is empty', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: '',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(() => {
			const submitButton = getByTestId(`${TEST_MODAL_KEY}-submit-button`);
			expect(submitButton).toBeDisabled();
		});
	});

	it('should disable submit button when version name is only whitespace', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: '   ',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(() => {
			const submitButton = getByTestId(`${TEST_MODAL_KEY}-submit-button`);
			expect(submitButton).toBeDisabled();
		});
	});

	it('should not submit when version name is empty', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const submitHandler = vi.fn();
		eventBus.on('submit', submitHandler);

		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: '',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		await waitFor(async () => {
			const nameInput = getByTestId(`${TEST_MODAL_KEY}-version-name-input`);
			await userEvent.clear(nameInput);

			const submitButton = getByTestId(`${TEST_MODAL_KEY}-submit-button`);
			expect(submitButton).toBeDisabled();
		});

		expect(submitHandler).not.toHaveBeenCalled();
	});

	it('should disable submit and inputs when publish limit is reached', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const submitHandler = vi.fn();
		eventBus.on('submit', submitHandler);

		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: 'Test Version',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		const workflowsStore = useWorkflowsStore();
		workflowsStore.setWorkflowNxtwavePublish({
			publishCount: 2,
			maxPublishCount: 2,
			isLimitReached: true,
		});
		await nextTick();

		const submitButton = getByTestId(`${TEST_MODAL_KEY}-submit-button`);
		expect(submitButton).toBeDisabled();

		const nameInput = getByTestId(`${TEST_MODAL_KEY}-version-name-input`);
		expect(nameInput).toBeDisabled();

		await userEvent.click(submitButton);
		expect(submitHandler).not.toHaveBeenCalled();
	});

	it('should disable submit and inputs when workflow publish is disabled by env flag', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();
		const submitHandler = vi.fn();
		eventBus.on('submit', submitHandler);

		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: 'Test Version',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		const settingsStore = useSettingsStore();
		settingsStore.settings.envFeatureFlags = {
			...settingsStore.settings.envFeatureFlags,
			N8N_ENV_FEAT_DISABLE_WORKFLOW_PUBLISH: 'true',
		};
		await nextTick();

		const submitButton = getByTestId(`${TEST_MODAL_KEY}-submit-button`);
		expect(submitButton).toBeDisabled();

		const nameInput = getByTestId(`${TEST_MODAL_KEY}-version-name-input`);
		expect(nameInput).toBeDisabled();

		await userEvent.click(submitButton);
		expect(submitHandler).not.toHaveBeenCalled();
	});

	it('should show publish count pill when maxPublishCount is set', async () => {
		const eventBus = createEventBus<WorkflowVersionFormModalEventBusEvents>();

		const { getByTestId } = renderComponent({
			props: {
				modalName: TEST_MODAL_KEY,
				data: {
					versionId: 'version-123',
					versionName: 'Test Version',
					modalTitle: 'Test Modal',
					submitButtonLabel: 'Submit',
					eventBus,
				},
			},
		});

		const workflowsStore = useWorkflowsStore();
		workflowsStore.setWorkflowNxtwavePublish({
			publishCount: 1,
			maxPublishCount: 5,
			isLimitReached: false,
		});
		await nextTick();

		const pill = getByTestId(`${TEST_MODAL_KEY}-publish-count-pill`);
		expect(pill).toHaveTextContent('1/5');
	});
});
