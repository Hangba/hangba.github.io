import * as THREE from "three";
import type { Planet } from "../data/planets";

type StageState = {
    raf: number;
    sphere: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    scene: THREE.Scene;
    planet: Planet;
    hqLoaded: boolean;
};

let state: StageState | null = null;
let scrollHandlerAttached = false;
const SCROLL_PAGES = new Set(["home", "blog", "about", "contact", "tags"]);
const SWALLOW_DURATION = 700;

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

function upgradeToHQ(loader: THREE.TextureLoader, stage: StageState) {
    if (stage.hqLoaded || !stage.planet.colorMapHQ) return;
    loader.load(
        stage.planet.colorMapHQ,
        (hq) => {
            hq.colorSpace = THREE.SRGBColorSpace;
            hq.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
            const old = stage.material.map;
            stage.material.map = hq;
            stage.material.needsUpdate = true;
            if (old) old.dispose();
            stage.hqLoaded = true;
        },
        undefined,
        () => {
            // HQ texture not available — silently stay on 2k
        }
    );
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

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    camera.position.set(0, 0, 2.7);

    const loader = new THREE.TextureLoader();
    const colorMap = loader.load(planet.colorMap, () => {
        // 2k done — schedule HQ upgrade on idle to keep first paint crisp
        if (state) {
            const req =
                (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
                    .requestIdleCallback;
            const kick = () => upgradeToHQ(loader, state!);
            if (req) req(kick);
            else setTimeout(kick, 600);
        }
    });
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const material = new THREE.MeshStandardMaterial({
        map: colorMap,
        roughness: 1,
        metalness: 0,
    });

    const geometry = new THREE.SphereGeometry(1, 96, 96);
    const sphere = new THREE.Mesh(geometry, material);
    sphere.rotation.x = 0.15;
    scene.add(sphere);

    scene.add(new THREE.AmbientLight(0xffffff, planet.ambientLight));
    const sun = new THREE.DirectionalLight(0xfff5e8, planet.sunIntensity);
    sun.position.set(-5, 2.5, 3);
    scene.add(sun);

    state = {
        raf: 0,
        sphere,
        material,
        renderer,
        camera,
        scene,
        planet,
        hqLoaded: false,
    };

    const tick = () => {
        if (!state) return;
        if (!reduced()) state.sphere.rotation.y += planet.rotationSpeed;
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
        state.camera.aspect = nw / nh;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(nw, nh, false);
    });
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
    const e = event as Event & { loader: () => Promise<unknown> };
    const original = e.loader;
    document.documentElement.classList.remove("is-revealed");
    document.documentElement.classList.add("is-swallowing");
    e.loader = async () => {
        await Promise.all([
            new Promise((r) => setTimeout(r, SWALLOW_DURATION)),
            original(),
        ]);
    };
});

document.addEventListener("astro:after-swap", () => {
    document.documentElement.classList.remove("is-swallowing");
    window.scrollTo(0, 0);
    refreshScrollOnNav();
});

document.addEventListener("astro:page-load", () => {
    init();
    requestAnimationFrame(() =>
        document.documentElement.classList.add("is-revealed")
    );
});

if (document.readyState !== "loading") {
    init();
} else {
    document.addEventListener("DOMContentLoaded", init);
}
