<script lang="ts" setup>
import BaseLayout from './BaseLayout.vue';
import AppSidebar from '@/app/components/app/AppSidebar.vue';
import { routerNavigating } from '@/app/router';
import { N8nSpinner } from '@n8n/design-system';
</script>

<template>
	<BaseLayout>
		<template #sidebar>
			<AppSidebar />
		</template>
		<!-- Overlay is a direct slot child so PageViewLayout stays centered by BaseLayout. -->
		<div
			v-show="routerNavigating"
			:class="$style.routeLoadingOverlay"
			aria-busy="true"
			aria-label="Loading page"
		>
			<N8nSpinner />
		</div>
		<Suspense>
			<RouterView />
			<template #fallback>
				<div :class="$style.routeLoading" aria-busy="true" aria-label="Loading page">
					<N8nSpinner />
				</div>
			</template>
		</Suspense>
	</BaseLayout>
</template>

<style lang="scss" module>
.routeLoadingOverlay {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--color--background--light-2, var(--canvas--color--background, #121212));
}

.routeLoading {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	max-width: var(--content-container--width);
	min-height: 60vh;

	* {
		color: var(--color--primary);
		min-height: 40px;
		min-width: 40px;
	}
}
</style>
