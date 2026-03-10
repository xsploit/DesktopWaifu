import * as THREE from 'three';

export interface SceneRefs {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	key: THREE.DirectionalLight;
	fill: THREE.DirectionalLight;
	rim: THREE.DirectionalLight;
	hemi: THREE.HemisphereLight;
	ambient: THREE.AmbientLight;
	clock: THREE.Clock;
}

export function isDesktopShell() {
	if (window.location.protocol === 'views:' || window.location.protocol === 'file:') return true;
	if (document.documentElement.dataset.desktopShell === 'electrobun') return true;
	if (window.location.search.includes('desktop=1')) return true;
	return false;
}

export function getRenderPixelRatio() {
	const reported = window.devicePixelRatio || 1;
	if (isDesktopShell() && reported <= 1.05) {
		return 2;
	}
	return Math.min(Math.max(reported, 1), 2);
}

export function getViewportSize(canvas: HTMLCanvasElement) {
	const rect = canvas.getBoundingClientRect();
	return {
		width: Math.max(1, Math.round(rect.width || window.innerWidth || 1)),
		height: Math.max(1, Math.round(rect.height || window.innerHeight || 1))
	};
}

export function createScene(canvas: HTMLCanvasElement): SceneRefs {
	const { width, height } = getViewportSize(canvas);
	const transparentCanvas = isDesktopShell();
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: transparentCanvas,
		premultipliedAlpha: true
	});
	renderer.setPixelRatio(getRenderPixelRatio());
	renderer.setSize(width, height, false);
	renderer.setClearColor(0x02040a, transparentCanvas ? 0 : 1);
	renderer.autoClear = true;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.85;
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.shadowMap.enabled = false;
	renderer.domElement.style.background = 'transparent';

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
	camera.position.set(0, 1.45, 3.2);
	camera.lookAt(0, 1.4, 0);
	scene.add(camera);

	const key = new THREE.DirectionalLight(0xffffff, 0.8);
	key.position.set(1.5, 2.2, 1.2);

	const fill = new THREE.DirectionalLight(0xbad1ff, 0.3);
	fill.position.set(-1.4, 1.5, -1.0);

	const rim = new THREE.DirectionalLight(0x8fbaff, 0.35);
	rim.position.set(-1.2, 2.0, -2.0);

	const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x1c1f26, 0.35);

	const ambient = new THREE.AmbientLight(0xffffff, 0.35);

	scene.add(key, fill, rim, hemi, ambient);

	const clock = new THREE.Clock();

	return { renderer, scene, camera, key, fill, rim, hemi, ambient, clock };
}

export function resizeScene(refs: SceneRefs, canvas?: HTMLCanvasElement) {
	const { renderer, camera } = refs;
	const { width, height } = canvas ? getViewportSize(canvas) : {
		width: Math.max(1, window.innerWidth || 1),
		height: Math.max(1, window.innerHeight || 1)
	};
	renderer.setPixelRatio(getRenderPixelRatio());
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	renderer.setSize(width, height, false);
}
