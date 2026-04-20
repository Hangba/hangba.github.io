import { withBase } from "../utils/paths";

export type Planet = {
    id: string;
    name: string;
    colorMap: string;
    colorMapHQ?: string;
    themeColor: string;
    accentColor: string;
    rotationSpeed: number;
    ambientLight: number;
    sunIntensity: number;
    roughness?: number;
    tiltDeg?: number;
    // Blog-post body theme when this planet is active:
    //   "paper"   — warm cream background, dark serif text (Venus/Saturn/Jupiter)
    //   "texture" — tiled sphere colorMap background, white text on blur (Moon/Mercury)
    postTheme?: "paper" | "texture";
    // Earth-style cloud overlay (second sphere, alpha-mapped)
    cloudMap?: string;
    cloudMapHQ?: string;
    cloudOpacity?: number;
    cloudRotationSpeed?: number;
    // Saturn-style ring system
    ringMap?: string;
    ringInnerRadius?: number;
    ringOuterRadius?: number;
};

export const planets: Planet[] = [
    {
        id: "moon",
        name: "月球",
        colorMap: withBase("/textures/moon_2k.jpg"),
        colorMapHQ: withBase("/textures/moon_8k.jpg"),
        themeColor: "#c9b9a8",
        accentColor: "#e2d1c3",
        rotationSpeed: 0.00015,
        ambientLight: 0.05,
        sunIntensity: 2.4,
        tiltDeg: 8.6,
        postTheme: "texture",
    },
    {
        id: "mercury",
        name: "水星",
        colorMap: withBase("/textures/mercury_2k.jpg"),
        colorMapHQ: withBase("/textures/mercury_8k.jpg"),
        themeColor: "#9aa2ad",
        accentColor: "#c8cfd9",
        rotationSpeed: 0.00012,
        ambientLight: 0.04,
        sunIntensity: 2.5,
        tiltDeg: 2,
        postTheme: "texture",
    },
    {
        id: "venus",
        name: "金星",
        colorMap: withBase("/textures/venus_2k.jpg"),
        colorMapHQ: withBase("/textures/venus_4k.jpg"),
        themeColor: "#e0bf7a",
        accentColor: "#f5e0a8",
        rotationSpeed: 0.0001,
        ambientLight: 0.28,
        sunIntensity: 2.2,
        tiltDeg: 3,
        postTheme: "paper",
    },
    {
        id: "mars",
        name: "火星",
        colorMap: withBase("/textures/mars_2k.jpg"),
        colorMapHQ: withBase("/textures/mars_8k.jpg"),
        themeColor: "#c96845",
        accentColor: "#e08460",
        rotationSpeed: 0.0002,
        ambientLight: 0.07,
        sunIntensity: 2.3,
        tiltDeg: 25.2,
        postTheme: "texture",
    },
    {
        id: "jupiter",
        name: "木星",
        colorMap: withBase("/textures/jupiter_2k.jpg"),
        colorMapHQ: withBase("/textures/jupiter_8k.jpg"),
        themeColor: "#c88a5c",
        accentColor: "#eab58a",
        rotationSpeed: 0.0004,
        ambientLight: 0.18,
        sunIntensity: 2.2,
        tiltDeg: 3,
        postTheme: "paper",
    },
    {
        id: "saturn",
        name: "土星",
        colorMap: withBase("/textures/saturn_2k.jpg"),
        colorMapHQ: withBase("/textures/saturn_8k.jpg"),
        themeColor: "#eace88",
        accentColor: "#f5e0b0",
        rotationSpeed: 0.00035,
        ambientLight: 0.18,
        sunIntensity: 2.0,
        tiltDeg: 26.7,
        postTheme: "paper",
        ringMap: withBase("/textures/saturn_ring_alpha_2k.png"),
        ringInnerRadius: 1.24,
        ringOuterRadius: 2.3,
    },
];

export function getTodayPlanet(): Planet {
    const epoch = Date.UTC(2026, 0, 1);
    const dayIndex = Math.floor((Date.now() - epoch) / 86400000);
    const len = planets.length;
    return planets[((dayIndex % len) + len) % len];
}
