<script setup lang="ts">
import { N8nSpinner } from '@n8n/design-system';
</script>

<template>
	<div :class="$style.wrapper" data-test-id="node-view-loader">
		<div :class="$style.spinner">
			<N8nSpinner />
		</div>
	</div>
</template>

<style lang="scss" module>
.wrapper {
	position: fixed;
	inset: 0;
	z-index: 9997;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--color--background--light-2, var(--canvas--color--background, #121212));
}

.spinner {
	margin: 0 auto;

	* {
		color: var(--color--primary);
		min-height: 40px;
		min-width: 40px;
	}
}
</style>
