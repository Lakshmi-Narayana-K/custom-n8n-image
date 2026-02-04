<script setup lang="ts">
import Modal from '@/app/components/Modal.vue';
import { N8nHeading, N8nButton, N8nTooltip } from '@n8n/design-system';
import WorkflowPublishForm from '@/app/components/WorkflowPublishForm.vue';
import { WORKFLOW_HISTORY_PUBLISH_MODAL_KEY } from '@/app/constants';
import { useI18n } from '@n8n/i18n';
import { createEventBus } from '@n8n/utils/event-bus';
import { useWorkflowActivate } from '@/app/composables/useWorkflowActivate';
import { useUIStore } from '@/app/stores/ui.store';
import { ref, onMounted, onBeforeUnmount, useTemplateRef, computed } from 'vue';
import { generateVersionName } from '@/features/workflows/workflowHistory/utils';
import type { EventBus } from '@n8n/utils/event-bus';
import { useWorkflowsStore } from '@/app/stores/workflows.store';
import { useEnvFeatureFlag } from '@/features/shared/envFeatureFlag/useEnvFeatureFlag';

export type WorkflowHistoryPublishModalEventBusEvents = {
	publish: { versionId: string; name: string; description: string };
	cancel: undefined;
};

const props = defineProps<{
	modalName: string;
	data: {
		versionId: string;
		workflowId: string;
		formattedCreatedAt: string;
		versionName?: string;
		description?: string;
		eventBus: EventBus<WorkflowHistoryPublishModalEventBusEvents>;
	};
}>();

const i18n = useI18n();
const modalEventBus = createEventBus();
const workflowActivate = useWorkflowActivate();
const uiStore = useUIStore();
const workflowsStore = useWorkflowsStore();
const { check: checkEnvFeatureFlag } = useEnvFeatureFlag();

const publishForm = useTemplateRef<InstanceType<typeof WorkflowPublishForm>>('publishForm');

const versionName = ref('');
const description = ref('');

function onModalOpened() {
	publishForm.value?.focusInput();
}

onMounted(() => {
	// Populate version name from existing data or generate from version ID
	if (props.data.versionName) {
		versionName.value = props.data.versionName;
	} else if (props.data.versionId) {
		versionName.value = generateVersionName(props.data.versionId);
	}

	// Populate description if available
	if (props.data.description) {
		description.value = props.data.description;
	}

	modalEventBus.on('opened', onModalOpened);
});

onBeforeUnmount(() => {
	modalEventBus.off('opened', onModalOpened);
});

const closeModal = () => {
	uiStore.closeModal(props.modalName);
};

const onCancel = () => {
	props.data.eventBus.emit('cancel');
	closeModal();
};

const isPublishDisabled = ref(false);
const isWorkflowPublishDisabled = computed(() =>
	checkEnvFeatureFlag.value('DISABLE_WORKFLOW_PUBLISH'),
);
const isPublishLimitReached = computed(
	() => workflowsStore.workflow?.nxtwavePublish?.isLimitReached ?? false,
);
const maxPublishCount = computed(() => workflowsStore.workflow?.nxtwavePublish?.maxPublishCount);
const publishCount = computed(() => workflowsStore.workflow?.nxtwavePublish?.publishCount ?? 0);
const limitReachedTooltip = computed(() =>
	i18n.baseText('workflows.publish.limitReachedTooltip', {
		interpolate: {
			count: String(publishCount.value),
			max: maxPublishCount.value ? String(maxPublishCount.value) : '',
		},
	}),
);
const publishing = ref(false);

const handlePublish = async () => {
	if (isWorkflowPublishDisabled.value || isPublishLimitReached.value) {
		return;
	}
	if (versionName.value.trim().length === 0) {
		return;
	}

	publishing.value = true;
	const { success } = await workflowActivate.publishWorkflow(
		props.data.workflowId,
		props.data.versionId,
		{
			name: versionName.value,
			description: description.value,
		},
	);

	publishing.value = false;

	if (success) {
		props.data.eventBus.emit('publish', {
			versionId: props.data.versionId,
			name: versionName.value,
			description: description.value,
		});
		closeModal();
	}
};
</script>

<template>
	<Modal
		width="500px"
		max-height="85vh"
		:name="WORKFLOW_HISTORY_PUBLISH_MODAL_KEY"
		:event-bus="modalEventBus"
		:center="true"
		:before-close="onCancel"
	>
		<template #header>
			<N8nHeading size="xlarge">{{ i18n.baseText('workflows.publishModal.title') }}</N8nHeading>
		</template>
		<template #content>
			<div :class="$style.content">
				<WorkflowPublishForm
					ref="publishForm"
					v-model:version-name="versionName"
					v-model:description="description"
					version-name-test-id="workflow-history-publish-version-name-input"
					description-test-id="workflow-history-publish-description-input"
				/>
				<div :class="$style.actions">
					<N8nButton
						:disabled="publishing"
						type="secondary"
						:label="i18n.baseText('generic.cancel')"
						data-test-id="workflow-history-publish-cancel-button"
						@click="onCancel"
					/>
					<N8nTooltip
						:content="
							isWorkflowPublishDisabled
								? i18n.baseText('workflows.publish.disabledTooltip')
								: limitReachedTooltip
						"
						:disabled="!isWorkflowPublishDisabled && !isPublishLimitReached"
						placement="top"
					>
						<div :class="$style.publishButtonWrapper">
							<N8nButton
								:disabled="
									isWorkflowPublishDisabled ||
									isPublishLimitReached ||
									isPublishDisabled ||
									versionName.trim().length === 0
								"
								:label="i18n.baseText('workflows.publish')"
								data-test-id="workflow-history-publish-button"
								@click="handlePublish"
							/>
						</div>
					</N8nTooltip>
					<N8nButton
						:loading="publishing"
						:disabled="versionName.trim().length === 0"
						:label="i18n.baseText('workflows.publish')"
						data-test-id="workflow-history-publish-button"
						@click="handlePublish"
					/>
				</div>
			</div>
		</template>
	</Modal>
</template>
<style lang="scss" module>
.content {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--lg);
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: var(--spacing--xs);
}

.publishButtonWrapper {
	cursor: not-allowed;
}
</style>
