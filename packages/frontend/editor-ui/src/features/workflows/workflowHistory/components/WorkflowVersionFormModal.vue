<script setup lang="ts">
import Modal from '@/app/components/Modal.vue';
import { N8nHeading, N8nButton, N8nTooltip } from '@n8n/design-system';
import WorkflowVersionForm from '@/app/components/WorkflowVersionForm.vue';
import { useI18n } from '@n8n/i18n';
import { createEventBus } from '@n8n/utils/event-bus';
import { useUIStore } from '@/app/stores/ui.store';
import { useWorkflowsStore } from '@/app/stores/workflows.store';
import { useEnvFeatureFlag } from '@/features/shared/envFeatureFlag/useEnvFeatureFlag';
import { ref, computed, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
import { generateVersionLabelFromId } from '@/features/workflows/workflowHistory/utils';
import type { EventBus } from '@n8n/utils/event-bus';

export type WorkflowVersionFormModalEventBusEvents = {
	submit: { versionId: string; name: string; description: string };
	cancel: undefined;
};

export type WorkflowVersionFormModalData = {
	versionId: string;
	versionName?: string;
	description?: string;
	modalTitle: string;
	submitButtonLabel: string;
	submitting?: boolean;
	eventBus: EventBus<WorkflowVersionFormModalEventBusEvents>;
};

const props = defineProps<{
	modalName: string;
	data: WorkflowVersionFormModalData;
}>();

const i18n = useI18n();
const modalEventBus = createEventBus();
const uiStore = useUIStore();
const workflowsStore = useWorkflowsStore();
const { check: checkEnvFeatureFlag } = useEnvFeatureFlag();

const versionForm = useTemplateRef<InstanceType<typeof WorkflowVersionForm>>('versionForm');

const versionName = ref('');
const description = ref('');

const submitting = computed(() => props.data.submitting ?? false);

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

const inputsDisabled = computed(
	() => isWorkflowPublishDisabled.value || isPublishLimitReached.value || submitting.value,
);

const isSubmitDisabled = computed(
	() => inputsDisabled.value || versionName.value.trim().length === 0,
);

function onModalOpened() {
	versionForm.value?.focusInput();
}

onMounted(() => {
	if (props.data.versionName) {
		versionName.value = props.data.versionName;
	} else if (props.data.versionId) {
		versionName.value = generateVersionLabelFromId(props.data.versionId);
	}

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

const handleSubmit = () => {
	if (isWorkflowPublishDisabled.value || isPublishLimitReached.value) {
		return;
	}
	if (versionName.value.trim().length === 0) {
		return;
	}

	props.data.eventBus.emit('submit', {
		versionId: props.data.versionId,
		name: versionName.value,
		description: description.value,
	});
};
</script>

<template>
	<Modal
		width="500px"
		max-height="85vh"
		:name="modalName"
		:event-bus="modalEventBus"
		:center="true"
		:before-close="onCancel"
	>
		<template #header>
			<N8nHeading size="xlarge">{{ data.modalTitle }}</N8nHeading>
		</template>
		<template #content>
			<div :class="$style.content">
				<div v-if="maxPublishCount" :class="$style.publishCountRow">
					<span :class="$style.publishCountPill" :data-test-id="`${modalName}-publish-count-pill`">
						{{ publishCount }}/{{ maxPublishCount }}
					</span>
				</div>
				<WorkflowVersionForm
					ref="versionForm"
					v-model:version-name="versionName"
					v-model:description="description"
					:disabled="inputsDisabled"
					:version-name-test-id="`${modalName}-version-name-input`"
					:description-test-id="`${modalName}-description-input`"
					@submit="handleSubmit"
				/>
				<div :class="$style.actions">
					<N8nButton
						variant="subtle"
						:disabled="submitting"
						:label="i18n.baseText('generic.cancel')"
						:data-test-id="`${modalName}-cancel-button`"
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
								:loading="submitting"
								:disabled="isSubmitDisabled"
								:label="data.submitButtonLabel"
								:data-test-id="`${modalName}-submit-button`"
								@click="handleSubmit"
							/>
						</div>
					</N8nTooltip>
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

.publishCountRow {
	display: flex;
	justify-content: flex-end;
}

.publishCountPill {
	padding: 0 var(--spacing--3xs);
	border-radius: var(--radius);
	font-size: var(--font-size--2xs);
	line-height: var(--line-height--sm);
	background: var(--color--foreground--tint-2);
	color: var(--color--text--shade-1);
}

.publishButtonWrapper {
	cursor: not-allowed;
}
</style>
