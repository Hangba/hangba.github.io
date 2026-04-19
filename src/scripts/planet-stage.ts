import * as THREE from "three";
import type { Planet } from "../data/planets";

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
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    loader: THREE.TextureLoader;
    stageEl: HTMLElement;
    planet: Planet;
    hqLoaded: boolean;
};

let state: StageState | null = null;
let scrollHandlerAttached = false;
const SCROLL_PAGES = new Set(["home", "blog", "about", "contact", "tags"]);
const NAVIGATE_DURATION = 900;

function pathToPage(pathname: string): string {
    if (pathname === "/" || pathname === "") return "home";
    if (pathname.startsWith("/blog")) return "blog";
    if (pathname.startsWith("/tags")) return "tags";
    if (pathname.startsWith("/about")) return "about";
    if (pathname.startsWith("/contact")) return "contact";
    return "home";
}

const CAMERA_FOV = 50;
const SPHERE_FILL = 0.85;
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
    planet: Planet
): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } | null {
    if (!planet.ringMap || !planet.ringInnerRadius || !planet.ringOuterRadius) {
        return null;
    }
    const ringTex = loader.load(planet.ringMap);
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
    planet: Planet
): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } | null {
    if (!planet.cloudMap) return null;
    const cloudTex = loader.load(planet.cloudMap);
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

/**
 * Hot-swap the planet at runtime: new textures, tilt, optional cloud, optional
 * ring, lighting, and CSS theme variables — without re-creating the scene.
 * Exposed on window so Hero's cycler button (or any other caller) can trigger it.
 */
function switchPlanet(nextPlanet: Planet) {
    if (!state) return;
    const s = state;

    s.planet = nextPlanet;
    s.hqLoaded = false;

    // Sphere texture + roughness swap
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
        }
    );

    // Axial tilt (applied to group so rings/clouds inherit it)
    s.bodyGroup.rotation.x = ((nextPlanet.tiltDeg ?? 8.6) * Math.PI) / 180;

    // Cloud layer: add / remove / swap as needed
    if (nextPlanet.cloudMap) {
        if (s.cloud && s.cloudMaterial) {
            // Swap texture on the existing cloud mesh
            s.loader.load(nextPlanet.cloudMap, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
                const mat = s.cloudMaterial!;
                const oldMap = mat.map;
                const oldAlpha = mat.alphaMap;
                mat.map = tex;
                mat.alphaMap = tex;
                mat.opacity = nextPlanet.cloudOpacity ?? 0.85;
                mat.needsUpdate = true;
                if (oldMap) oldMap.dispose();
                if (oldAlpha && oldAlpha !== oldMap) oldAlpha.dispose();
            });
        } else {
            const built = buildCloud(s.loader, s.renderer, nextPlanet);
            if (built) {
                s.bodyGroup.add(built.mesh);
                s.cloud = built.mesh;
                s.cloudMaterial = built.material;
            }
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
        const built = buildRing(s.loader, s.renderer, nextPlanet);
        if (built) {
            s.bodyGroup.add(built.mesh);
            s.ring = built.mesh;
            s.ringMaterial = built.material;
        }
    }

    // Camera distance retunes when ring state changes (rings need more headroom)
    applyCameraFill(s);

    // Lighting
    s.ambientLight.intensity = nextPlanet.ambientLight;
    s.sun.intensity = nextPlanet.sunIntensity;

    // CSS theme variables + persistent data-planet attribute
    const root = document.documentElement;
    root.style.setProperty("--planet-theme", nextPlanet.themeColor);
    root.style.setProperty("--planet-accent", nextPlanet.accentColor);
    s.stageEl.dataset.planet = JSON.stringify(nextPlanet);
    try {
        sessionStorage.setItem("planet:current", JSON.stringify(nextPlanet));
    } catch {
        /* ignore */
    }
}

function startThree(stage: HTMLElement, planet: Planet) {
    if (state) return;
    const canvas = stage.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    const fillFactor = planet.ringMap ? RING_SPHERE_FILL : SPHERE_FILL;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, w / h, 0.1, 100);
    camera.position.set(0, 0, cameraDistanceFor(w / h, fillFactor));

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
        camera,
        scene,
        loader,
        stageEl: stage,
        planet,
        hqLoaded: false,
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
        }
        state.renderer.render(state.scene, state.camera);
        state.raf = requestAnimationFrame(tick);
    };
    tick();

    document.addEventListener("visibilitychange", () => {
        if (!state) return;
        if (document.hidden) cancelAnimationFrame(state.raf);
        else tick();
    });

    window.addEventListener("resize", () => {
        if (!state) return;
        const nw = stage.clientWidth || window.innerWidth;
        const nh = stage.clientHeight || window.innerHeight;
        state.renderer.setSize(nw, nh, false);
        applyCameraFill(state);
    });

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

function reapplyThemeFromStage() {
    const stage = document.getElementById("planet-stage");
    const root = document.documentElement;
    let planet: Planet | null = null;
    if (stage) {
        planet = readPlanet(stage);
    }
    if (!planet) {
        try {
            const raw = sessionStorage.getItem("planet:current");
            if (raw) planet = JSON.parse(raw) as Planet;
        } catch {
            /* ignore */
        }
    }
    if (!planet) return;
    root.style.setProperty("--planet-theme", planet.themeColor);
    root.style.setProperty("--planet-accent", planet.accentColor);
}

function init() {
    const stage = document.getElementById("planet-stage");
    if (!stage) return;
    const planet = readPlanet(stage);
    if (!planet) return;

    if (!hasWebGL()) {
        startFallback(stage, planet);
    } else {
        startThree(stage, planet);
    }
    attachScrollDriver();
    requestAnimationFrame(() =>
        document.documentElement.classList.add("is-revealed")
    );
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

    root.classList.remove("is-revealed");
    root.classList.add("is-navigating");
    root.style.setProperty("--planet-progress", "0");
    root.dataset.page = targetPage;

    e.loader = async () => {
        await Promise.all([
            new Promise((r) => setTimeout(r, NAVIGATE_DURATION)),
            original(),
        ]);
    };
});

document.addEventListener("astro:after-swap", () => {
    document.documentElement.classList.remove("is-navigating");
    window.scrollTo(0, 0);
    reapplyThemeFromStage();
    refreshScrollOnNav();
});

document.addEventListener("astro:page-load", () => {
    init();
    reapplyThemeFromStage();
    requestAnimationFrame(() =>
        document.documentElement.classList.add("is-revealed")
    );
});

if (document.readyState !== "loading") {
    init();
} else {
    document.addEventListener("DOMContentLoaded", init);
}
