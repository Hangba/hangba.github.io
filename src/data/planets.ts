import { withBase } from "../utils/helpers";

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
    },
];

export function getTodayPlanet(): Planet {
    const epoch = Date.UTC(2026, 0, 1);
    const dayIndex = Math.floor((Date.now() - epoch) / 86400000);
    const len = planets.length;
    return planets[((dayIndex % len) + len) % len];
}
