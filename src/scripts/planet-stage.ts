import * as THREE from "three";
import { planets, type Planet } from "../data/planets";

type StageState = {
    raf: number;
    sphere: THREE.Mesh;
    sphereGeometry: THREE.SphereGeometry;
    material: THREE.MeshStandardMaterial;
    cloud?: THREE.Mesh;
    cloudMaterial?: THREE.MeshStandardMaterial;
    ring?: THREE.Mesh;
    ringMaterial?: THREE.MeshBasicMaterial;
    bodyGroup: THREE.Group;
    ambientLight: THREE.AmbientLight;
    sun: THREE.DirectionalLight;
    renderer: THREE.WebGLRenderer;
    starRenderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    starCamera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    starScene: THREE.Scene;
    loader: THREE.TextureLoader;
    stageEl: HTMLElement;
    starStageEl: HTMLElement;
    planet: Planet;
    stars?: THREE.Points;
    targetStarsX?: number;
    targetStarsY?: number;
    hqLoaded: boolean;
    onPlanetClick?: (event: MouseEvent) => void;
    onPointerMove?: (event: PointerEvent) => void;
    onPointerLeave?: () => void;
    onVisibilityChange?: () => void;
    onWindowResize?: () => void;
    onViewportResize?: () => void;
    stageResizeObserver?: ResizeObserver;
};

let state: StageState | null = null;
let scrollHandlerAttached = false;
const SCROLL_PAGES = new Set(["home", "blog", "about", "friends", "tags"]);
const NAVIGATE_DURATION = 900;
const CONTENT_ENTER_DURATION = 220;
const PLANET_SWITCH_OUT_MS = 360;
const PLANET_SWITCH_IN_MS = 920;
const STAR_PARALLAX_X = 0.1;
const STAR_PARALLAX_Y = 0.07;
let enteringClassTimer: number | undefined;
let planetSwitching = false;
const planetClickRaycaster = new THREE.Raycaster();
const planetClickPointer = new THREE.Vector2();

function isMobileMenuExpanded(): boolean {
    return document.documentElement.dataset.mobileMenuExpanded === "true";
}

function pathToPage(pathname: string): string {
    if (pathname === "/" || pathname === "") return "home";
    if (pathname.startsWith("/blog")) return "blog";
    if (pathname.startsWith("/tags")) return "tags";
    if (pathname.startsWith("/about")) return "about";
    if (pathname.startsWith("/friends")) return "friends";
    return "home";
}

const CAMERA_FOV = 50;
const SPHERE_FILL = 0.85;
// Tuned so Saturn's tilted ring just fits inside the camera's vertical frustum.
// Going higher starts clipping the near ring edge — the geometry is culled by
// the camera, not the CSS container, so it cannot be fixed by enlarging the
// stage. Use the per-page `--p-s` CSS scale to make Saturn visually larger.
const RING_SPHERE_FILL = 0.52;

function cameraDistanceFor(aspect: number, fillFactor = SPHERE_FILL): number {
    const halfV = (CAMERA_FOV / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const halfMin = Math.min(halfV, halfH);
    return 1 / Math.tan(halfMin * fillFactor);
}

function reduced(): boolean {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasWebGL(): boolean {
    try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
        return false;
    }
}

function readPlanet(stage: HTMLElement): Planet | null {
    const raw = stage.dataset.planet;
    if (!raw) return null;
    try {
        return JSON.parse(raw) as Planet;
    } catch {
        return null;
    }
}

function buildRing(
    loader: THREE.TextureLoader,
    renderer: THREE.WebGLRenderer,
    planet: Planet,
    onLoad?: () => void
): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } | null {
    if (!planet.ringMap || !planet.ringInnerRadius || !planet.ringOuterRadius) {
        return null;
    }
    const ringTex = loader.load(
        planet.ringMap,
        onLoad ? () => onLoad() : undefined,
        undefined,
        onLoad ? () => onLoad() : undefined
    );
    ringTex.colorSpace = THREE.SRGBColorSpace;
    ringTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const inner = planet.ringInnerRadius;
    const outer = planet.ringOuterRadius;
    const ringGeo = new THREE.RingGeometry(inner, outer, 192, 1);
    const pos = ringGeo.attributes.position;
    const uv = ringGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const r = Math.sqrt(x * x + y * y);
        const t = (r - inner) / (outer - inner);
        uv.setXY(i, t, 0.5);
    }
    uv.needsUpdate = true;

    const ringMat = new THREE.MeshBasicMaterial({
        map: ringTex,
        color: new THREE.Color(planet.accentColor),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    return { mesh: ring, material: ringMat };
}

function buildCloud(
    loader: THREE.TextureLoader,
    renderer: THREE.WebGLRenderer,
    planet: Planet,
    onLoad?: () => void
): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } | null {
    if (!planet.cloudMap) return null;
    const cloudTex = loader.load(
        planet.cloudMap,
        onLoad ? () => onLoad() : undefined,
        undefined,
        onLoad ? () => onLoad() : undefined
    );
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    cloudTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
        map: cloudTex,
        alphaMap: cloudTex,
        transparent: true,
        opacity: planet.cloudOpacity ?? 0.85,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
    });
    const geo = new THREE.SphereGeometry(1.015, 96, 96);
    const mesh = new THREE.Mesh(geo, mat);
    return { mesh, material: mat };
}

function disposeMesh(mesh: THREE.Mesh) {
    (mesh.geometry as THREE.BufferGeometry).dispose();
    const material = mesh.material as
        | THREE.MeshStandardMaterial
        | THREE.MeshBasicMaterial;
    if (material.map) material.map.dispose();
    if (
        "alphaMap" in material &&
        material.alphaMap &&
        material.alphaMap !== material.map
    ) {
        material.alphaMap.dispose();
    }
    material.dispose();
}

function upgradeToHQ(loader: THREE.TextureLoader, stage: StageState) {
    if (stage.hqLoaded) return;
    const tasks: Promise<void>[] = [];

    if (stage.planet.colorMapHQ) {
        tasks.push(
            new Promise<void>((resolve) => {
                loader.load(
                    stage.planet.colorMapHQ!,
                    (hq) => {
                        hq.colorSpace = THREE.SRGBColorSpace;
                        hq.anisotropy =
                            stage.renderer.capabilities.getMaxAnisotropy();
                        const old = stage.material.map;
                        stage.material.map = hq;
                        stage.material.needsUpdate = true;
                        if (old) old.dispose();
                        resolve();
                    },
                    undefined,
                    () => resolve()
                );
            })
        );
    }

    if (stage.planet.cloudMapHQ && stage.cloudMaterial) {
        tasks.push(
            new Promise<void>((resolve) => {
                loader.load(
                    stage.planet.cloudMapHQ!,
                    (hq) => {
                        hq.colorSpace = THREE.SRGBColorSpace;
                        hq.anisotropy =
                            stage.renderer.capabilities.getMaxAnisotropy();
                        const mat = stage.cloudMaterial!;
                        const oldMap = mat.map;
                        const oldAlpha = mat.alphaMap;
                        mat.map = hq;
                        mat.alphaMap = hq;
                        mat.needsUpdate = true;
                        if (oldMap) oldMap.dispose();
                        if (oldAlpha && oldAlpha !== oldMap) oldAlpha.dispose();
                        resolve();
                    },
                    undefined,
                    () => resolve()
                );
            })
        );
    }

    Promise.all(tasks).finally(() => {
        stage.hqLoaded = true;
    });
}

function applyCameraFill(s: StageState) {
    const w = s.stageEl.clientWidth || window.innerWidth;
    const h = s.stageEl.clientHeight || window.innerHeight;
    const fill = s.planet.ringMap ? RING_SPHERE_FILL : SPHERE_FILL;
    s.camera.aspect = w / h;
    s.camera.position.z = cameraDistanceFor(w / h, fill);
    s.camera.updateProjectionMatrix();
}

function syncRendererSize(s: StageState) {
    const w = s.starStageEl.clientWidth || window.innerWidth;
    const h = s.starStageEl.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;
    s.renderer.setSize(w, h, false);
    s.starRenderer.setSize(w, h, false);
    applyCameraFill(s);
    s.starCamera.aspect = w / h;
    s.starCamera.updateProjectionMatrix();
}

/**
 * Hot-swap the planet at runtime: new textures, tilt, optional cloud, optional
 * ring, lighting, and CSS theme variables — without re-creating the scene.
 * Exposed on window so Hero's cycler button (or any other caller) can trigger it.
 *
 * Returns a Promise that resolves once the new textures (sphere colorMap, and
 * cloud/ring maps if present) have finished loading. Callers that need to avoid
 * flashing the previous texture during the transition should await it.
 */
function applyPlanetSwap(s: StageState, nextPlanet: Planet): Promise<void> {

    s.planet = nextPlanet;
    s.hqLoaded = false;

    const loadTasks: Promise<void>[] = [];

    // Sphere texture + roughness swap
    loadTasks.push(
        new Promise<void>((resolve) => {
            s.loader.load(
                nextPlanet.colorMap,
                (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
                    const old = s.material.map;
                    s.material.map = tex;
                    s.material.roughness = nextPlanet.roughness ?? 1;
                    s.material.needsUpdate = true;
                    if (old) old.dispose();
                    const req = (
                        window as unknown as {
                            requestIdleCallback?: (cb: () => void) => void;
                        }
                    ).requestIdleCallback;
                    const kick = () => upgradeToHQ(s.loader, s);
                    if (req) req(kick);
                    else setTimeout(kick, 600);
                    resolve();
                },
                undefined,
                () => resolve()
            );
        })
    );

    // Axial tilt (applied to group so rings/clouds inherit it)
    s.bodyGroup.rotation.x = ((nextPlanet.tiltDeg ?? 8.6) * Math.PI) / 180;

    // Cloud layer: add / remove / swap as needed
    if (nextPlanet.cloudMap) {
        if (s.cloud && s.cloudMaterial) {
            // Swap texture on the existing cloud mesh
            loadTasks.push(
                new Promise<void>((resolve) => {
                    s.loader.load(
                        nextPlanet.cloudMap!,
                        (tex) => {
                            tex.colorSpace = THREE.SRGBColorSpace;
                            tex.anisotropy =
                                s.renderer.capabilities.getMaxAnisotropy();
                            const mat = s.cloudMaterial!;
                            const oldMap = mat.map;
                            const oldAlpha = mat.alphaMap;
                            mat.map = tex;
                            mat.alphaMap = tex;
                            mat.opacity = nextPlanet.cloudOpacity ?? 0.85;
                            mat.needsUpdate = true;
                            if (oldMap) oldMap.dispose();
                            if (oldAlpha && oldAlpha !== oldMap) oldAlpha.dispose();
                            resolve();
                        },
                        undefined,
                        () => resolve()
                    );
                })
            );
        } else {
            loadTasks.push(
                new Promise<void>((resolve) => {
                    const built = buildCloud(s.loader, s.renderer, nextPlanet, () =>
                        resolve()
                    );
                    if (built) {
                        s.bodyGroup.add(built.mesh);
                        s.cloud = built.mesh;
                        s.cloudMaterial = built.material;
                    } else {
                        resolve();
                    }
                })
            );
        }
    } else if (s.cloud) {
        s.bodyGroup.remove(s.cloud);
        disposeMesh(s.cloud);
        s.cloud = undefined;
        s.cloudMaterial = undefined;
    }

    // Ring system: add / remove / rebuild
    const ringChanged =
        !!nextPlanet.ringMap !== !!s.ring ||
        (nextPlanet.ringMap &&
            s.ring &&
            ((s.ring.geometry as THREE.RingGeometry).parameters.innerRadius !==
                nextPlanet.ringInnerRadius ||
                (s.ring.geometry as THREE.RingGeometry).parameters.outerRadius !==
                    nextPlanet.ringOuterRadius));

    if (ringChanged && s.ring) {
        s.bodyGroup.remove(s.ring);
        disposeMesh(s.ring);
        s.ring = undefined;
        s.ringMaterial = undefined;
    }
    if (nextPlanet.ringMap && !s.ring) {
        loadTasks.push(
            new Promise<void>((resolve) => {
                const built = buildRing(s.loader, s.renderer, nextPlanet, () =>
                    resolve()
                );
                if (built) {
                    s.bodyGroup.add(built.mesh);
                    s.ring = built.mesh;
                    s.ringMaterial = built.material;
                } else {
                    resolve();
                }
            })
        );
    }

    // Camera distance retunes when ring state changes (rings need more headroom)
    applyCameraFill(s);

    // Lighting
    s.ambientLight.intensity = nextPlanet.ambientLight;
    s.sun.intensity = nextPlanet.sunIntensity;

    // CSS theme variables + persistent data-planet attribute
    applyPlanetAttributes(nextPlanet);
    s.stageEl.dataset.planet = JSON.stringify(nextPlanet);
    try {
        sessionStorage.setItem("planet:currentId", nextPlanet.id);
        sessionStorage.removeItem("planet:current");
    } catch {
        /* ignore */
    }

    return Promise.all(loadTasks).then(() => undefined);
}

async function animatePlanetOut(stageEl: HTMLElement): Promise<Animation | null> {
    if (reduced() || typeof stageEl.animate !== "function") return null;

    const fadeOut = stageEl.animate(
        [
            {
                transform: "translate3d(var(--p-x, 0vw), var(--p-y, 0vh), 0) rotate(var(--p-r, 0deg)) scale(var(--p-s, 1))",
                opacity: 1,
                filter: "blur(0)",
            },
            {
                transform: "translate3d(-58vw, -58vh, 0) rotate(var(--p-r, 0deg)) scale(0.14)",
                opacity: 0,
                filter: "blur(2px)",
            },
        ],
        {
            duration: PLANET_SWITCH_OUT_MS,
            easing: "cubic-bezier(0.55, 0.02, 0.73, 0.19)",
            fill: "forwards",
        }
    );

    await fadeOut.finished.catch(() => undefined);
    // Leave the animation forward-filled so the sphere stays parked at the
    // upper-left corner (invisible) while we wait for the next texture to
    // load. The caller cancels it once animatePlanetIn has taken over.
    return fadeOut;

}

async function animatePlanetIn(
    stageEl: HTMLElement,
    previousOut: Animation | null
) {
    if (reduced() || typeof stageEl.animate !== "function") {
        if (previousOut) previousOut.cancel();
        return;
    }

    const fadeIn = stageEl.animate(
        [
            {
                transform: "translate3d(-58vw, -58vh, 0) rotate(var(--p-r, 0deg)) scale(0.14)",
                opacity: 0,
                filter: "blur(2px)",
            },
            {
                transform: "translate3d(var(--p-x, 0vw), var(--p-y, 0vh), 0) rotate(var(--p-r, 0deg)) scale(var(--p-s, 1))",
                opacity: 1,
                filter: "blur(0)",
            },
        ],
        {
            duration: PLANET_SWITCH_IN_MS,
            easing: "cubic-bezier(0.19, 1, 0.22, 1)",
            fill: "forwards",
        }
    );

    // fadeIn now drives the element; release the forward-filled out animation
    // so canceling fadeIn at the end returns the element to its default state.
    if (previousOut) previousOut.cancel();

    await fadeIn.finished.catch(() => undefined);
    fadeIn.cancel();
}

async function switchPlanet(nextPlanet: Planet) {
    if (!state || planetSwitching) return;
    planetSwitching = true;
    const s = state;

    try {
        const outAnim = await animatePlanetOut(s.stageEl);
        // Wait for the new textures to finish loading before revealing the
        // planet, so the in-animation never shows the previous texture.
        await applyPlanetSwap(s, nextPlanet);
        await animatePlanetIn(s.stageEl, outAnim);
    } finally {
        planetSwitching = false;
    }
}

function getNextPlanet(currentPlanet: Planet): Planet | null {
    const currentIndex = planets.findIndex((p) => p.id === currentPlanet.id);
    if (currentIndex === -1) return null;
    return planets[(currentIndex + 1) % planets.length];
}

function didClickPlanet(event: MouseEvent, s: StageState): boolean {
    const rect = s.stageEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    planetClickPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    planetClickPointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    planetClickRaycaster.setFromCamera(planetClickPointer, s.camera);

    const hitTargets: THREE.Object3D[] = [s.sphere];
    if (s.cloud) hitTargets.push(s.cloud);
    if (s.ring) hitTargets.push(s.ring);

    return planetClickRaycaster.intersectObjects(hitTargets, false).length > 0;
}

function startThree(stage: HTMLElement, planet: Planet) {
    if (state) return;
    const canvas = stage.querySelector("canvas") as HTMLCanvasElement | null;
    const starStage = document.getElementById("star-stage") as HTMLElement | null;
    const starCanvas = starStage?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas || !starStage || !starCanvas) return;

    const w = starStage.clientWidth || window.innerWidth;
    const h = starStage.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const starRenderer = new THREE.WebGLRenderer({
        canvas: starCanvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
    });
    starRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    starRenderer.setSize(w, h, false);
    starRenderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const starScene = new THREE.Scene();

    const fillFactor = planet.ringMap ? RING_SPHERE_FILL : SPHERE_FILL;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, w / h, 0.1, 100);
    camera.position.set(0, 0, cameraDistanceFor(w / h, fillFactor));
    const starCamera = new THREE.PerspectiveCamera(CAMERA_FOV, w / h, 0.1, 300);
    starCamera.position.set(0, 0, 1);

    const loader = new THREE.TextureLoader();
    const colorMap = loader.load(planet.colorMap, () => {
        if (state) {
            const req = (
                window as unknown as {
                    requestIdleCallback?: (cb: () => void) => void;
                }
            ).requestIdleCallback;
            const kick = () => upgradeToHQ(loader, state!);
            if (req) req(kick);
            else setTimeout(kick, 600);
        }
    });
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const material = new THREE.MeshStandardMaterial({
        map: colorMap,
        roughness: planet.roughness ?? 1,
        metalness: 0,
    });

    const sphereGeometry = new THREE.SphereGeometry(1, 96, 96);
    const sphere = new THREE.Mesh(sphereGeometry, material);

    const tiltRad = ((planet.tiltDeg ?? 8.6) * Math.PI) / 180;
    const bodyGroup = new THREE.Group();
    bodyGroup.rotation.x = tiltRad;
    scene.add(bodyGroup);
    bodyGroup.add(sphere);

    const cloudBuilt = buildCloud(loader, renderer, planet);
    if (cloudBuilt) bodyGroup.add(cloudBuilt.mesh);

    const ringBuilt = buildRing(loader, renderer, planet);
    if (ringBuilt) bodyGroup.add(ringBuilt.mesh);

    
    const starsGeo = new THREE.BufferGeometry();
    const starsCount = Math.floor(2000 + Math.random() * 1000);
    const posArray = new Float32Array(starsCount * 3);
    for(let i = 0; i < starsCount * 3; i++) {
        posArray[i] = (Math.random() - 0.5) * 200;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const starsMat = new THREE.PointsMaterial({
        size: 0.22,
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        sizeAttenuation: true
    });
    const starPoints = new THREE.Points(starsGeo, starsMat);
    starScene.add(starPoints);

    const ambientLight = new THREE.AmbientLight(0xffffff, planet.ambientLight);
    scene.add(ambientLight);
    const sun = new THREE.DirectionalLight(0xfff5e8, planet.sunIntensity);
    sun.position.set(-5, 2.5, 3);
    scene.add(sun);

    state = {
        raf: 0,
        sphere,
        sphereGeometry,
        material,
        cloud: cloudBuilt?.mesh,
        cloudMaterial: cloudBuilt?.material,
        ring: ringBuilt?.mesh,
        ringMaterial: ringBuilt?.material,
        bodyGroup,
        ambientLight,
        sun,
        renderer,
        starRenderer,
        camera,
        starCamera,
        scene,
        starScene,
        loader,
        stageEl: stage,
        starStageEl: starStage,
        planet,
        hqLoaded: false,
        stars: starPoints,
        targetStarsX: 0,
        targetStarsY: 0,
    };

    const tick = () => {
        if (!state) return;
        if (!reduced()) {
            state.sphere.rotation.y += state.planet.rotationSpeed;
            if (state.cloud) {
                state.cloud.rotation.y +=
                    state.planet.cloudRotationSpeed ??
                    state.planet.rotationSpeed * 1.3;
            }
            if (state.stars) {
                state.stars.rotation.y += (state.targetStarsX! - state.stars.rotation.y) * 0.05;
                state.stars.rotation.x += (state.targetStarsY! - state.stars.rotation.x) * 0.05;
            }
        }
        state.starRenderer.render(state.starScene, state.starCamera);
        state.renderer.render(state.scene, state.camera);
        state.raf = requestAnimationFrame(tick);
    };
    tick();

    const onVisibilityChange = () => {
        if (!state) return;
        if (document.hidden) cancelAnimationFrame(state.raf);
        else tick();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    const onPlanetClick = (event: MouseEvent) => {
        if (
            !state ||
            planetSwitching ||
            isMobileMenuExpanded() ||
            !didClickPlanet(event, state)
        ) {
            return;
        }

        const nextPlanet = getNextPlanet(state.planet);
        if (!nextPlanet) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        switchPlanet(nextPlanet);
    };
    window.addEventListener("click", onPlanetClick, { capture: true });

    const onPointerMove = (event: PointerEvent) => {
        if (!state || !state.stars || reduced()) return;

        const x = (event.clientX / window.innerWidth) * 2 - 1;
        const y = (event.clientY / window.innerHeight) * 2 - 1;
        state.targetStarsY = x * STAR_PARALLAX_X;
        state.targetStarsX = y * STAR_PARALLAX_Y;
    };

    const onPointerLeave = () => {
        if (!state || reduced()) return;
        state.targetStarsX = 0;
        state.targetStarsY = 0;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });


    let resizeRaf = 0;
    const scheduleResize = () => {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            if (!state) return;
            syncRendererSize(state);
        });
    };

    window.addEventListener("resize", scheduleResize, { passive: true });
    const viewport = window.visualViewport;
    if (viewport) {
        viewport.addEventListener("resize", scheduleResize, { passive: true });
        viewport.addEventListener("scroll", scheduleResize, { passive: true });
    }

    const stageResizeObserver = new ResizeObserver(() => {
        scheduleResize();
    });
    stageResizeObserver.observe(stage);

    state.onVisibilityChange = onVisibilityChange;
    state.onPlanetClick = onPlanetClick;
    state.onPointerMove = onPointerMove;
    state.onPointerLeave = onPointerLeave;
    state.onWindowResize = scheduleResize;
    state.onViewportResize = scheduleResize;
    state.stageResizeObserver = stageResizeObserver;

    // Expose hot-swap for Hero's cycler button (or any other runtime caller)
    (window as unknown as { __switchPlanet?: (p: Planet) => void }).__switchPlanet =
        switchPlanet;
}

function startFallback(stage: HTMLElement, planet: Planet) {
    stage.classList.add("planet-fallback");
    stage.style.setProperty("--planet-color-map", `url(${planet.colorMap})`);
}

function attachScrollDriver() {
    if (scrollHandlerAttached) return;
    scrollHandlerAttached = true;
    const root = document.documentElement;
    let pending = false;
    const update = () => {
        const page = root.dataset.page || "";
        if (!SCROLL_PAGES.has(page)) {
            root.style.setProperty("--planet-progress", "0");
            return;
        }
        const p = Math.min(1, Math.max(0, window.scrollY / window.innerHeight));
        root.style.setProperty("--planet-progress", String(p));
    };
    const onScroll = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            update();
            pending = false;
        });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    (window as unknown as { __planetRefreshScroll?: () => void }).__planetRefreshScroll =
        update;
}

function refreshScrollOnNav() {
    const fn = (window as unknown as { __planetRefreshScroll?: () => void })
        .__planetRefreshScroll;
    if (fn) fn();
}

function runHomePlanetIntro() {
    const root = document.documentElement;
    if (root.dataset.page !== "home") {
        root.classList.remove("home-planet-preload", "home-planet-entered");
        return;
    }

    root.classList.add("home-planet-preload");
    root.classList.remove("home-planet-entered");

    if (reduced()) {
        root.classList.add("home-planet-entered");
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (document.documentElement.dataset.page === "home") {
                    document.documentElement.classList.add("home-planet-entered");
                }
            }, 260);
        });
    });
}

function applyPlanetAttributes(planet: Planet) {
    const root = document.documentElement;
    applyPlanetAttributesTo(root, planet);
}

function applyPlanetAttributesTo(root: HTMLElement, planet: Planet) {
    root.style.setProperty("--planet-theme", planet.themeColor);
    root.style.setProperty("--planet-accent", planet.accentColor);
    if (planet.postTheme === "texture") {
        root.style.setProperty("--planet-texture", `url('${planet.colorMap}')`);
    } else {
        root.style.removeProperty("--planet-texture");
    }
    if (planet.postTheme) {
        root.dataset.postTheme = planet.postTheme;
    } else {
        delete root.dataset.postTheme;
    }
    root.dataset.planetId = planet.id;
}

function getPersistedPlanet(): Planet | null {
    try {
        const id = sessionStorage.getItem("planet:currentId");
        if (id) return planets.find((p) => p.id === id) ?? null;
    } catch {
        /* ignore */
    }
    if (state?.planet) return state.planet;
    const stage = document.getElementById("planet-stage");
    if (stage) {
        return readPlanet(stage);
    }
    return null;
}

function reapplyThemeFromStage() {
    let planet: Planet | null = null;
    try {
        const id = sessionStorage.getItem("planet:currentId");
        if (id) {
            planet = planets.find((p) => p.id === id) ?? null;
        }
    } catch {
        /* ignore */
    }

    const stage = document.getElementById("planet-stage");
    if (!planet && stage) {
        planet = readPlanet(stage);
    }
    if (!planet) return;
    applyPlanetAttributes(planet);
}

function destroyStage() {
    if (!state) return;
    const s = state;
    cancelAnimationFrame(s.raf);
    try {
        if (s.onVisibilityChange) {
            document.removeEventListener("visibilitychange", s.onVisibilityChange);
        }
        if (s.onPlanetClick) {
            window.removeEventListener("click", s.onPlanetClick, { capture: true });
        }
        if (s.onPointerMove) {
            window.removeEventListener("pointermove", s.onPointerMove);
        }
        if (s.onPointerLeave) {
            window.removeEventListener("pointerleave", s.onPointerLeave);
        }
        if (s.stars) {
            disposeMesh(s.stars as unknown as THREE.Mesh);
        }
        if (s.onWindowResize) {
            window.removeEventListener("resize", s.onWindowResize);
        }
        if (s.onViewportResize && window.visualViewport) {
            window.visualViewport.removeEventListener("resize", s.onViewportResize);
            window.visualViewport.removeEventListener("scroll", s.onViewportResize);
        }
        if (s.stageResizeObserver) {
            s.stageResizeObserver.disconnect();
        }
        if (s.cloud) disposeMesh(s.cloud);
        if (s.ring) disposeMesh(s.ring);
        s.sphereGeometry.dispose();
        if (s.material.map) s.material.map.dispose();
        s.material.dispose();
        s.renderer.dispose();
        s.starRenderer.dispose();
    } catch {
        /* ignore */
    }
    state = null;
}

function init() {
    const stage = document.getElementById("planet-stage");
    const starStage = document.getElementById("star-stage");
    if (!stage || !starStage) {
        if (state) destroyStage();
        return;
    }

    // `astro:before-preparation` hides the persistent stage when leaving home.
    // When we come back, clear the inline display override before reusing it.
    stage.style.removeProperty("display");

    if (state && state.stageEl !== stage) {
        destroyStage();
    }
    const stagePlanet = readPlanet(stage);
    let planet: Planet | null = null;
    try {
        const id = sessionStorage.getItem("planet:currentId");
        if (id) {
            planet = planets.find((p) => p.id === id) ?? null;
        }
    } catch {
        /* ignore */
    }
    if (!planet) {
        planet = stagePlanet;
    }
    if (!planet) return;

    // Keep persisted stage payload in sync so subsequent theme reapply stays stable.
    stage.dataset.planet = JSON.stringify(planet);

    if (!hasWebGL()) {
        startFallback(stage, planet);
    } else {
        startThree(stage, planet);
    }
    attachScrollDriver();
}

document.addEventListener("astro:before-preparation", (event) => {
    if (reduced()) return;
    const e = event as Event & {
        loader: () => Promise<unknown>;
        to: URL;
    };
    const original = e.loader;
    const root = document.documentElement;
    const targetPage = pathToPage(e.to.pathname);

    if (targetPage !== "home") {
        root.classList.remove("home-planet-preload", "home-planet-entered");
    }

    // Persist the active planet on every navigation so target pages without
    // a stage element can still reapply the same theme immediately.
    try {
        const currentId =
            state?.planet.id ||
            (() => {
                const stage = document.getElementById("planet-stage");
                if (!stage) return null;
                const p = readPlanet(stage);
                return p?.id ?? null;
            })() ||
            root.dataset.planetId ||
            null;
        if (currentId) {
            sessionStorage.setItem("planet:currentId", currentId);
        }
    } catch {
        /* ignore */
    }

    root.classList.add("is-navigating");
    root.classList.remove("is-entering");
    if (enteringClassTimer) {
        window.clearTimeout(enteringClassTimer);
        enteringClassTimer = undefined;
    }
    root.style.setProperty("--planet-progress", "0");

    if (targetPage !== "home") {
        const stage = document.getElementById("planet-stage");
        if (stage) stage.style.display = "none";
    }
    e.loader = original;
});

document.addEventListener("astro:after-swap", () => {
    const root = document.documentElement;
    root.classList.remove("is-navigating");
    root.classList.add("is-entering");
    if (window.location.pathname === "/") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    reapplyThemeFromStage();
    refreshScrollOnNav();
    runHomePlanetIntro();
    if (enteringClassTimer) {
        window.clearTimeout(enteringClassTimer);
    }
    enteringClassTimer = window.setTimeout(() => {
        requestAnimationFrame(() => {
            root.classList.remove("is-entering");
            enteringClassTimer = undefined;
        });
    }, Math.min(CONTENT_ENTER_DURATION + 60, NAVIGATE_DURATION));
});

document.addEventListener("astro:before-swap", (event) => {
    const e = event as Event & { newDocument?: Document };
    const newDocument = e.newDocument;
    if (!newDocument) return;
    const planet = getPersistedPlanet();
    if (!planet) return;
    applyPlanetAttributesTo(newDocument.documentElement, planet);
});

document.addEventListener("astro:page-load", () => {
    init();
    reapplyThemeFromStage();
    runHomePlanetIntro();
});

if (document.readyState !== "loading") {
    init();
    runHomePlanetIntro();
} else {
    document.addEventListener("DOMContentLoaded", init);
    document.addEventListener("DOMContentLoaded", runHomePlanetIntro);
}
