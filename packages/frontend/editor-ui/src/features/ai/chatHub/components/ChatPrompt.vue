<script setup lang="ts">
import { useToast } from '@/app/composables/useToast';
import type { ChatHubLLMProvider, ChatModelDto, ChatSessionId } from '@n8n/api-types';
import { useSpeechRecognition } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import {
	isLlmProviderModel,
	enrichMimeTypesWithExtensions,
} from '@/features/ai/chatHub/chat.utils';
import { useI18n } from '@n8n/i18n';
import type { MessagingState } from '@/features/ai/chatHub/chat.types';
import { useChatStore } from '@/features/ai/chatHub/chat.store';
import ChatPromptCallouts from './ChatPromptCallouts.vue';
import ChatPromptCompact from './ChatPromptCompact.vue';
import ChatPromptFull from './ChatPromptFull.vue';

const props = defineProps<{
	messagingState: MessagingState;
	isNewSession: boolean;
	isToolsSelectable: boolean;
	selectedModel: ChatModelDto | null;
	checkedToolIds: string[];
	sessionId?: ChatSessionId;
	customAgentId?: string;
	showCreditsClaimedCallout: boolean;
	showDynamicCredentialsMissingCallout: boolean;
	aiCreditsQuota: string;
	compact?: boolean;
	placeholder?: string;
}>();

const chatStore = useChatStore();

const emit = defineEmits<{
	submit: [message: string, attachments: File[]];
	stop: [];
	selectModel: [];
	setCredentials: [ChatHubLLMProvider];
	editAgent: [agentId: string];
	dismissCreditsCallout: [];
	openDynamicCredentials: [];
}>();

const activePromptRef = ref<InstanceType<typeof ChatPromptCompact | typeof ChatPromptFull>>();
const message = ref('');
const committedSpokenMessage = ref('');
const attachments = ref<File[]>([]);

const toast = useToast();
const i18n = useI18n();

const speechInput = useSpeechRecognition({
	continuous: true,
	interimResults: true,
	lang: navigator.language,
});

const placeholder = computed(() => {
	if (props.placeholder) {
		return props.placeholder;
	}
	if (props.selectedModel) {
		return i18n.baseText('chatHub.chat.prompt.placeholder.withModel', {
			interpolate: { model: props.selectedModel.name ?? 'a model' },
		});
	}
	return i18n.baseText('chatHub.chat.prompt.placeholder.selectModel');
});

const llmProvider = computed<ChatHubLLMProvider | undefined>(() =>
	isLlmProviderModel(props.selectedModel?.model) ? props.selectedModel?.model.provider : undefined,
);

const acceptedMimeTypes = computed(() =>
	enrichMimeTypesWithExtensions(props.selectedModel?.metadata.allowedFilesMimeTypes ?? ''),
);

const canUploadFiles = computed(() => props.selectedModel?.metadata.allowFileUploads ?? false);

const showMissingAgentCallout = computed(() => props.messagingState === 'missingAgent');
const showMissingCredentialsCallout = computed(
	() => props.messagingState === 'missingCredentials' && !!llmProvider.value,
);

const calloutVisible = computed(() => {
	return (
		showMissingAgentCallout.value ||
		showMissingCredentialsCallout.value ||
		props.showDynamicCredentialsMissingCallout ||
		props.showCreditsClaimedCallout
	);
});

function onMic() {
	committedSpokenMessage.value = message.value;

	if (speechInput.isListening.value) {
		speechInput.stop();
	} else {
		speechInput.start();
	}
}

function onStop() {
	emit('stop');
}

function onAttach() {
	activePromptRef.value?.fileInputRef?.click();
}

function handleFileSelect(e: Event) {
	const target = e.target as HTMLInputElement;
	const files = target.files;

	if (!files || files.length === 0) {
		return;
	}

	// Store File objects directly instead of converting to base64
	for (const file of Array.from(files)) {
		attachments.value.push(file);
	}

	// Reset input
	if (target) {
		target.value = '';
	}

	activePromptRef.value?.inputRef?.focus();
}

function removeAttachment(removed: File) {
	attachments.value = attachments.value.filter((attachment) => attachment !== removed);
}

function handleSubmitForm() {
	const trimmed = message.value.trim();

	if (trimmed) {
		speechInput.stop();
		emit('submit', trimmed, attachments.value);
	}
}

function handleKeydownTextarea(e: KeyboardEvent) {
	const trimmed = message.value.trim();

	speechInput.stop();

	if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && trimmed) {
		e.preventDefault();
		e.stopPropagation();
		speechInput.stop();
		emit('submit', trimmed, attachments.value);
	}
}

watch(speechInput.result, (spoken) => {
	message.value = committedSpokenMessage.value + ' ' + spoken.trimStart();
});

watch(
	speechInput.isFinal,
	(final) => {
		if (final) {
			committedSpokenMessage.value = message.value;
		}
	},
	{ flush: 'post' },
);

watch(speechInput.error, (event) => {
	if (event?.error === 'not-allowed') {
		toast.showError(
			new Error(i18n.baseText('chatHub.chat.prompt.microphone.accessDenied')),
			i18n.baseText('chatHub.chat.prompt.microphone.allowAccess'),
		);
		return;
	}

	if (event?.error === 'no-speech') {
		toast.showMessage({
			title: i18n.baseText('chatHub.chat.prompt.microphone.noSpeech'),
			type: 'warning',
		});
	}
});

async function handleToolToggle(toolId: string) {
	if (props.customAgentId) {
		await chatStore.toggleCustomAgentTool(props.customAgentId, toolId);
		return;
	}
	if (props.sessionId) {
		// Existing session: toggle per-session tool
		await chatStore.toggleSessionTool(props.sessionId, toolId);
		return;
	}
	// New session: toggle global enabled state
	const tool = chatStore.configuredTools.find((t) => t.definition.id === toolId);
	if (tool) {
		await chatStore.toggleToolEnabled(toolId, !tool.enabled);
	}
}

defineExpose({
	focus: () => activePromptRef.value?.inputRef?.focus(),
	reset: () => {
		message.value = '';
		committedSpokenMessage.value = '';
		attachments.value = [];
	},
	setText: (text: string) => {
		message.value = text;
	},
	appendText: (text: string) => {
		message.value += text;
	},
	addAttachments: (files: File[]) => {
		attachments.value.push(...files);
		activePromptRef.value?.inputRef?.focus();
	},
});
</script>

<template>
	<ChatPromptCompact
		v-if="compact"
		ref="activePromptRef"
		v-model:message="message"
		:attachments="attachments"
		:placeholder="placeholder"
		:messaging-state="messagingState"
		:accepted-mime-types="acceptedMimeTypes"
		:can-upload-files="canUploadFiles"
		:callout-visible="calloutVisible"
		:is-speech-supported="speechInput.isSupported.value"
		:is-listening="speechInput.isListening.value"
		@submit="handleSubmitForm"
		@keydown="handleKeydownTextarea"
		@file-select="handleFileSelect"
		@attach="onAttach"
		@mic="onMic"
		@stop="onStop"
		@remove-attachment="removeAttachment"
	>
		<template #callouts>
			<ChatPromptCallouts
				:show-missing-agent-callout="showMissingAgentCallout"
				:show-missing-credentials-callout="showMissingCredentialsCallout"
				:show-dynamic-credentials-missing-callout="showDynamicCredentialsMissingCallout"
				:show-credits-claimed-callout="showCreditsClaimedCallout"
				:is-new-session="isNewSession"
				:llm-provider="llmProvider"
				:ai-credits-quota="aiCreditsQuota"
				compact
				@select-model="emit('selectModel')"
				@set-credentials="emit('setCredentials', $event)"
				@dismiss-credits-callout="emit('dismissCreditsCallout')"
				@open-dynamic-credentials="emit('openDynamicCredentials')"
			/>
		</template>
	</ChatPromptCompact>
	<ChatPromptFull
		v-else
		ref="activePromptRef"
		v-model:message="message"
		:attachments="attachments"
		:placeholder="placeholder"
		:messaging-state="messagingState"
		:accepted-mime-types="acceptedMimeTypes"
		:can-upload-files="canUploadFiles"
		:callout-visible="calloutVisible"
		:is-speech-supported="speechInput.isSupported.value"
		:is-listening="speechInput.isListening.value"
		:checked-tool-ids="checkedToolIds"
		:custom-agent-id="customAgentId"
		:is-tools-selectable="isToolsSelectable"
		:selected-model="selectedModel"
		@submit="handleSubmitForm"
		@keydown="handleKeydownTextarea"
		@file-select="handleFileSelect"
		@attach="onAttach"
		@mic="onMic"
		@stop="onStop"
		@remove-attachment="removeAttachment"
		@tool-toggle="handleToolToggle"
	>
		<template #callouts>
			<ChatPromptCallouts
				:show-missing-agent-callout="showMissingAgentCallout"
				:show-missing-credentials-callout="showMissingCredentialsCallout"
				:show-dynamic-credentials-missing-callout="showDynamicCredentialsMissingCallout"
				:show-credits-claimed-callout="showCreditsClaimedCallout"
				:is-new-session="isNewSession"
				:llm-provider="llmProvider"
				:ai-credits-quota="aiCreditsQuota"
				@select-model="emit('selectModel')"
				@set-credentials="emit('setCredentials', $event)"
				@dismiss-credits-callout="emit('dismissCreditsCallout')"
				@open-dynamic-credentials="emit('openDynamicCredentials')"
			/>
		</template>
	</ChatPromptFull>
</template>

<style lang="scss" module>
.prompt {
	display: grid;
	place-items: center;
}

.inputWrap {
	position: relative;
	display: flex;
	align-items: center;
	flex-direction: column;
	width: 100%;
}

.callout {
	width: 100%;
	padding: var(--spacing--sm);
	border-radius: 16px 16px 0 0;
	box-shadow: 0 10px 24px 0 #00000010;
}

.closeButton {
	margin-left: var(--spacing--sm);
}

.fileInput {
	display: none;
}

.inputWrapper {
	width: 100%;
	border-radius: 16px;
	padding: 16px;
	box-shadow: 0 10px 24px 0 #00000010;
	background-color: var(--color--background--light-3);
	border: var(--border);
	display: flex;
	flex-direction: column;
	gap: var(--spacing--md);
	transition: border-color 0.2s cubic-bezier(0.645, 0.045, 0.355, 1);
	--input--border-color: transparent;
	--input--border-color--hover: transparent;
	--input--border-color--focus: transparent;
	--input--color--background: transparent;

	&:focus-within,
	&:hover:has(textarea:not(:disabled)) {
		border-color: var(--color--secondary);
	}

	& textarea {
		font-size: var(--font-size--md);
		line-height: 1.5em;
		resize: none;
		padding: 0 !important;
	}

	&.calloutVisible {
		border-radius: 0 0 16px 16px;
		border-top: 0;
	}
}

.footer {
	display: flex;
	align-items: flex-end;
	justify-content: flex-end;
	gap: var(--spacing--sm);
}

.tools {
	flex-grow: 1;
}

.toolsButton {
	/* maintain the same height with other buttons regardless of selected tools */
	height: 30px;
}

.iconStack {
	display: flex;
	align-items: center;
	position: relative;
}

.icon {
	padding: var(--spacing--4xs);
	background-color: var(--button--color--background--secondary);
	border-radius: 50%;
	outline: 2px var(--color--background--light-3) solid;
}

.iconOverlap {
	margin-left: -6px;
}

.iconFallback {
	display: flex;
	align-items: center;
	justify-content: center;
}

.actions {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);

	& button path {
		stroke-width: 2.5;
	}
}

.attachments {
	display: flex;
	flex-wrap: wrap;
	gap: var(--spacing--2xs);
}

.recording {
	animation: chatHubPromptRecordingPulse 1.5s ease-in-out infinite;
}

@keyframes chatHubPromptRecordingPulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.6;
	}
}
</style>
